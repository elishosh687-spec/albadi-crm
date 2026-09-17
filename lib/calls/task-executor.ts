import { and, eq, inArray } from "drizzle-orm";
import { callActionCandidates, crmTasks } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { clampToWorkWindow } from "@/lib/clock/callback-window";
import { getBotSettings } from "@/lib/bot-settings/store";
import { resolveTaskAssigneeByContact } from "@/lib/crm-tasks/assignee";
import {
  createContactTask,
  listContactTasks,
  updateContactTask,
} from "@/integrations/ghl/client";
import { taskTitleForAction } from "./action-types";
import type { ProposedCallAction } from "./analysis-v2";

interface CandidateProposal {
  action: ProposedCallAction | null;
  resolvedDueAt: string | null;
  callSummary?: string;
  assignedToOverride?: string | null;
}

function markerFor(candidateId: number): string {
  return `[CALL-ACTION v2] candidate=${candidateId}`;
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export async function executeCallActionCandidate(candidateId: number): Promise<{
  executed: boolean;
  taskId?: string;
  reason?: string;
}> {
  const [candidate] = await db
    .select()
    .from(callActionCandidates)
    .where(eq(callActionCandidates.id, candidateId))
    .limit(1);
  if (!candidate) return { executed: false, reason: "candidate_not_found" };
  if (candidate.ghlTaskId && candidate.executionStatus === "executed") {
    return { executed: true, taskId: candidate.ghlTaskId, reason: "already_executed" };
  }
  if (candidate.status !== "approved") return { executed: false, reason: "candidate_not_approved" };

  const proposal = (candidate.editedProposal ?? candidate.proposal) as CandidateProposal;
  if (!proposal.action || !proposal.resolvedDueAt || !candidate.ghlContactId) {
    return { executed: false, reason: "proposal_incomplete" };
  }

  const [claim] = await db
    .update(callActionCandidates)
    .set({ executionStatus: "executing", updatedAt: new Date() })
    .where(
      and(
        eq(callActionCandidates.id, candidateId),
        eq(callActionCandidates.status, "approved"),
        inArray(callActionCandidates.executionStatus, ["pending", "failed", "not_requested"]),
      ),
    )
    .returning({ id: callActionCandidates.id });
  if (!claim) return { executed: false, reason: "execution_already_claimed" };

  try {
    const settings = await getBotSettings();
    const assignedTo =
      proposal.assignedToOverride?.trim() ||
      (settings.callAnalysisAssigneeMode === "fixed_user"
        ? settings.callAnalysisFixedAssigneeId.trim() || null
        : await resolveTaskAssigneeByContact(candidate.ghlContactId));
    if (!assignedTo) throw new Error("No GHL assignee could be resolved");

    const marker = markerFor(candidate.id);
    const existingTasks = await listContactTasks(candidate.ghlContactId);
    const exact = existingTasks.find((task) => !task.completed && (task.body ?? "").includes(marker));
    if (exact) {
      await markExecuted(candidate.id, exact.id);
      return { executed: true, taskId: exact.id, reason: "existing_marker" };
    }

    const title = taskTitleForAction(proposal.action);
    const comparable = normalizeComparable(title);
    const duplicateCutoff = Date.now() - settings.callAnalysisDuplicateWindowHours * 60 * 60 * 1000;
    const possibleDuplicate = existingTasks.find((task) => {
      if (task.completed) return false;
      const dueTime = new Date(task.dueDate).getTime();
      if (Number.isFinite(dueTime) && dueTime < duplicateCutoff) return false;
      const existing = normalizeComparable(task.title);
      return existing === comparable || existing.includes(comparable) || comparable.includes(existing);
    });
    if (possibleDuplicate) {
      const automationOwned = (possibleDuplicate.body ?? "").includes("[CALL-ACTION v2]");
      if (automationOwned && settings.callAnalysisSupersedeAutoTasks) {
        const due = await clampToWorkWindow(new Date(proposal.resolvedDueAt), new Date(), {
          start: settings.callAnalysisWorkdayStart,
          end: settings.callAnalysisWorkdayEnd,
        });
        const body = [
          marker,
          `מקור: ניתוח שיחה (${candidate.source})`,
          `פעולה: ${proposal.action.description}`,
          `ראיה: ${proposal.action.evidence.quote ?? "—"}`,
          "",
          `סיכום: ${proposal.callSummary ?? "—"}`,
        ].join("\n");
        const updated = await updateContactTask(candidate.ghlContactId, possibleDuplicate.id, {
          title,
          body,
          dueDate: due.toISOString(),
          assignedTo,
          completed: false,
        });
        await db
          .update(crmTasks)
          .set({ title, dueAt: due, assignedTo, updatedAt: new Date() })
          .where(eq(crmTasks.ghlTaskId, possibleDuplicate.id));
        await markExecuted(candidate.id, updated.id);
        return { executed: true, taskId: updated.id, reason: "superseded_automation_task" };
      }
      await db
        .update(callActionCandidates)
        .set({
          status: "pending",
          policyDecision: "needs_approval",
          decisionReason: "possible_duplicate",
          executionStatus: "not_requested",
          updatedAt: new Date(),
        })
        .where(eq(callActionCandidates.id, candidate.id));
      return { executed: false, reason: "possible_duplicate" };
    }

    const due = await clampToWorkWindow(new Date(proposal.resolvedDueAt), new Date(), {
      start: settings.callAnalysisWorkdayStart,
      end: settings.callAnalysisWorkdayEnd,
    });
    const created = await createContactTask(candidate.ghlContactId, {
      title,
      dueDate: due.toISOString(),
      assignedTo,
      body: [
        marker,
        `מקור: ניתוח שיחה (${candidate.source})`,
        `פעולה: ${proposal.action.description}`,
        `ראיה: ${proposal.action.evidence.quote ?? "—"}`,
        "",
        `סיכום: ${proposal.callSummary ?? "—"}`,
      ].join("\n"),
    });

    if (candidate.leadSid) {
      await db.insert(crmTasks).values({
        manychatSubId: candidate.leadSid,
        taskType: proposal.action.actionType,
        title,
        status: "open",
        assignedTo,
        dueAt: due,
        ghlTaskId: created.id,
      });
    }
    await markExecuted(candidate.id, created.id);
    return { executed: true, taskId: created.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(callActionCandidates)
      .set({
        status: "failed",
        executionStatus: "failed",
        attempts: candidate.attempts + 1,
        lastError: message.slice(0, 1000),
        lastErrorAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(callActionCandidates.id, candidate.id));
    return { executed: false, reason: message };
  }
}

async function markExecuted(candidateId: number, taskId: string): Promise<void> {
  await db
    .update(callActionCandidates)
    .set({
      status: "executed",
      executionStatus: "executed",
      ghlTaskId: taskId,
      lastError: null,
      lastErrorAt: null,
      updatedAt: new Date(),
    })
    .where(eq(callActionCandidates.id, candidateId));
}

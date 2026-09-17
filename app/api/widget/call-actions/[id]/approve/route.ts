import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { callActionCandidates } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { executeCallActionCandidate } from "@/lib/calls/task-executor";
import { CALL_ACTION_TYPES } from "@/lib/calls/action-types";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";

interface ApprovalBody {
  actionType?: string;
  description?: string;
  dueAt?: string;
  assignedTo?: string;
}

export const POST = withRequestLog(
  "widget",
  async (req: NextRequest, log, ctx: { params: Promise<{ id: string }> }) => {
    if (!widgetAuthed(req)) {
      log.warn("unauthorized");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const candidateId = Number(id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      return NextResponse.json({ ok: false, error: "invalid candidate id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as ApprovalBody;
    const [candidate] = await db
      .select()
      .from(callActionCandidates)
      .where(eq(callActionCandidates.id, candidateId))
      .limit(1);
    if (!candidate || !["pending", "failed"].includes(candidate.status)) {
      return NextResponse.json({ ok: false, error: "candidate is no longer pending" }, { status: 409 });
    }
    const original = candidate.proposal as Record<string, unknown>;
    const originalAction = (original.action ?? null) as Record<string, unknown> | null;
    const actionType = body.actionType ?? String(originalAction?.actionType ?? "");
    const description = (body.description ?? String(originalAction?.description ?? "")).trim();
    const dueAt = body.dueAt ?? String(original.resolvedDueAt ?? "");
    if (!CALL_ACTION_TYPES.includes(actionType as never) || description.length < 4) {
      return NextResponse.json({ ok: false, error: "פעולה לא תקינה" }, { status: 400 });
    }
    const parsedDue = new Date(dueAt);
    if (!dueAt || Number.isNaN(parsedDue.getTime())) {
      return NextResponse.json({ ok: false, error: "נדרש מועד תקין" }, { status: 400 });
    }
    const editedProposal = {
      ...original,
      action: { ...originalAction, actionType, description, responsibleParty: "salesperson" },
      resolvedDueAt: parsedDue.toISOString(),
      assignedToOverride: body.assignedTo?.trim() || null,
    };
    const [claimed] = await db
      .update(callActionCandidates)
      .set({
        editedProposal,
        status: "approved",
        executionStatus: "pending",
        decidedBy: "eli",
        decidedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(callActionCandidates.id, candidateId),
          eq(callActionCandidates.updatedAt, candidate.updatedAt),
        ),
      )
      .returning({ id: callActionCandidates.id });
    if (!claimed) {
      return NextResponse.json({ ok: false, error: "ההצעה השתנתה; רענן ונסה שוב" }, { status: 409 });
    }
    const execution = await executeCallActionCandidate(candidateId);
    log.info("call_action.approved", { candidateId, executed: execution.executed, reason: execution.reason });
    return NextResponse.json({ ok: execution.executed, execution }, { status: execution.executed ? 200 : 409 });
  },
);

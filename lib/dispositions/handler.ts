/**
 * Disposition handler — turns a "Eli clicked X after a call" event into:
 *   1. A GHL Task on the contact (so it appears in his daily queue)
 *   2. Optional opportunity stage move (FUTURE_FOLLOW_UP / LOST / WON / etc.)
 *   3. Optional follow-up counter bump (escalates to LOST at threshold)
 *   4. DB mirror update so the bot + dashboard see the same state
 *
 * Called from `app/api/ghl/disposition-set/route.ts` after GHL Workflow
 * posts the webhook payload to us. Idempotent at the webhook layer (each
 * GHL call event has a unique id; we dedupe on `bridge_events.evt_id`).
 */

import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  createContactTask,
  updateContact,
  updateOpportunity,
} from "@/integrations/ghl/client";
import { GHL_FIELD_IDS, GHL_STAGE_IDS } from "@/integrations/ghl/config";
import {
  findRule,
  type DispositionRule,
  type LossReason,
} from "./config";

export interface DispositionInput {
  /** GHL Contact id (always required — the webhook payload includes it). */
  contactId: string;
  /** GHL Opportunity id — required for stage moves. May be null on a
   *  contact without an open opportunity. */
  opportunityId?: string | null;
  /** Raw disposition name as typed in GHL Settings. */
  disposition: string;
}

export interface DispositionResult {
  applied: boolean;
  /** Human-readable summary for logs / API response. */
  message: string;
  taskId?: string;
  stageChangedTo?: string;
  followupCountAfter?: number;
  /** Set when escalateAfterN kicked in. */
  escalated?: boolean;
}

/**
 * Public entry point.
 */
export async function handleDisposition(
  input: DispositionInput
): Promise<DispositionResult> {
  const rule = findRule(input.disposition);
  if (!rule) {
    return {
      applied: false,
      message: `unknown disposition: "${input.disposition}"`,
    };
  }

  // Load lead from DB by ghl_contact_id (single source for name + summary +
  // current counter). If lead row missing, we still execute the GHL-side
  // actions and just skip DB mirror.
  const lead = await loadLeadByGhlContactId(input.contactId);

  // 1. Counter bump (DB + GHL custom field)
  let counterAfter: number | undefined;
  if (rule.incrementFollowupCount) {
    counterAfter = (lead?.followUpCount ?? 0) + 1;
    if (lead) {
      await db
        .update(leads)
        .set({
          followUpCount: counterAfter,
          updatedAt: new Date(),
        })
        .where(eq(leads.manychatSubId, lead.sid));
    }
    if (GHL_FIELD_IDS.follow_up_count) {
      try {
        await updateContact(input.contactId, {
          customFields: [
            { id: GHL_FIELD_IDS.follow_up_count, value: counterAfter },
          ],
        });
      } catch (e) {
        console.warn(
          `[dispositions] failed to push follow_up_count to GHL`,
          e
        );
      }
    }
  }

  // 2. Determine effective stage / loss reason (after potential escalation)
  let effectiveStage = rule.moveStage;
  let effectiveLossReason: LossReason | undefined = rule.lossReason;
  let escalated = false;
  if (
    rule.escalateAfterN &&
    counterAfter !== undefined &&
    counterAfter >= rule.escalateAfterN.threshold
  ) {
    effectiveStage = rule.escalateAfterN.moveStage;
    effectiveLossReason =
      rule.escalateAfterN.lossReason ?? effectiveLossReason;
    escalated = true;
  }

  // 3. Stage move (GHL + DB)
  let stageChangedTo: string | undefined;
  if (effectiveStage) {
    const stageId = GHL_STAGE_IDS[effectiveStage];
    if (!stageId) {
      console.warn(
        `[dispositions] missing GHL_STAGE_IDS[${effectiveStage}] in env — skipping stage move`
      );
    } else if (input.opportunityId) {
      const update: {
        pipelineStageId: string;
        status?: "open" | "won" | "lost" | "abandoned";
      } = { pipelineStageId: stageId };
      if (effectiveStage === "WON") update.status = "won";
      else if (effectiveStage === "LOST") update.status = "lost";
      try {
        await updateOpportunity(input.opportunityId, update);
        stageChangedTo = effectiveStage;
      } catch (e) {
        console.warn(
          `[dispositions] failed to move opportunity ${input.opportunityId} to ${effectiveStage}`,
          e
        );
      }
    }
    // DB mirror — done even if opportunity update fails so dashboard reflects intent
    if (lead) {
      const set: {
        pipelineStage: string;
        lossReason?: LossReason;
        updatedAt: Date;
      } = { pipelineStage: effectiveStage, updatedAt: new Date() };
      if (effectiveLossReason) set.lossReason = effectiveLossReason;
      await db.update(leads).set(set).where(eq(leads.manychatSubId, lead.sid));
    }
  }

  // 4. Loss reason → GHL custom field
  if (effectiveLossReason && GHL_FIELD_IDS.loss_reason) {
    try {
      await updateContact(input.contactId, {
        customFields: [
          { id: GHL_FIELD_IDS.loss_reason, value: effectiveLossReason },
        ],
      });
    } catch (e) {
      console.warn(`[dispositions] failed to push loss_reason to GHL`, e);
    }
  }

  // 5. Task creation
  let taskId: string | undefined;
  const taskRule = rule.createTask;
  const skipTaskBecauseTerminal =
    effectiveStage === "WON" || effectiveStage === "LOST";
  const allowAfterTerminal = taskRule?.fireAfterStageMove === true;
  if (taskRule && (!skipTaskBecauseTerminal || allowAfterTerminal)) {
    const dueDate = computeDueDate(taskRule.dueIn);
    const name =
      lead?.name?.split(" ")[0] || lead?.name || "הלקוח";
    const summary = (lead?.botSummary || "—").slice(0, 200);
    const title = taskRule.title
      .replace("{{name}}", name)
      .slice(0, 180);
    const body = (taskRule.body ?? "")
      .replace("{{name}}", name)
      .replace("{{summary}}", summary);
    try {
      const task = await createContactTask(input.contactId, {
        title,
        body,
        dueDate: dueDate.toISOString(),
      });
      taskId = task.id;
      // DB mirror — set follow_up_date so dashboard pickers + bot agree
      if (lead && GHL_FIELD_IDS.follow_up_date) {
        const dueDateStr = dueDate.toISOString().slice(0, 10);
        await db
          .update(leads)
          .set({
            followUpDate: dueDateStr,
            updatedAt: new Date(),
          })
          .where(eq(leads.manychatSubId, lead.sid));
        try {
          await updateContact(input.contactId, {
            customFields: [
              { id: GHL_FIELD_IDS.follow_up_date, value: dueDateStr },
            ],
          });
        } catch (e) {
          console.warn(`[dispositions] failed to push follow_up_date`, e);
        }
      }
    } catch (e) {
      console.warn(`[dispositions] failed to create task`, e);
    }
  }

  return {
    applied: true,
    message: `applied "${rule.name}" (${rule.label})${
      escalated ? " [escalated]" : ""
    }`,
    taskId,
    stageChangedTo,
    followupCountAfter: counterAfter,
    escalated,
  };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function computeDueDate(
  dueIn: { hours: number } | { days: number } | { months: number }
): Date {
  const now = new Date();
  if ("hours" in dueIn) {
    now.setHours(now.getHours() + dueIn.hours);
    return now;
  }
  if ("days" in dueIn) {
    now.setDate(now.getDate() + dueIn.days);
    return now;
  }
  // months — approximate as calendar months
  now.setMonth(now.getMonth() + dueIn.months);
  return now;
}

async function loadLeadByGhlContactId(contactId: string) {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      followUpCount: leads.followUpCount,
      botSummary: leads.botSummary,
      ghlOpportunityId: leads.ghlOpportunityId,
    })
    .from(leads)
    .where(eq(leads.ghlContactId, contactId))
    .limit(1);
  return rows[0] ?? null;
}

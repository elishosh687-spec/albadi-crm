"use server";

import { db } from "@/lib/db";
import { leads, messages as messagesTable } from "@/drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  suggestReplies as suggestRepliesLLM,
  type ConversationMessage,
} from "@/lib/autoresponder/suggest-reply";

// revalidatePath throws "static generation store missing" when called outside
// a Next.js request context (e.g. from tsx test scripts). Cache invalidation
// is best-effort — never let it break the action body.
function safeRevalidate(path: string, type: "layout" | "page" = "layout"): void {
  try {
    revalidatePath(path, type);
  } catch {
    /* outside Next request context — ignore */
  }
}
import {
  V2_FLAG_TAG_IDS,
  V2_PIPELINE_STAGES,
  type V2FlagName,
  type V2PipelineStage,
} from "@/lib/manychat/config";
import {
  addTag,
  getSubscriber,
  removeTag,
  setCustomFields,
} from "@/lib/messaging";
import { sendBridgeMessage } from "@/lib/bridge/client";

export interface SimpleResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function pushStageAndFlags(
  sid: string,
  stage: V2PipelineStage,
  flags: V2FlagName[]
): Promise<void> {
  const cleanSid = sid.trim();

  await setCustomFields(cleanSid, [
    { name: "pipeline_stage", value: stage },
  ]);

  const sub = await getSubscriber(cleanSid);
  const v2FlagTagIdValues = Object.values(V2_FLAG_TAG_IDS) as number[];
  const currentV2FlagTagIds: Set<number> = new Set(
    sub.tags.map((t) => t.id).filter((id) => v2FlagTagIdValues.includes(id))
  );

  const desiredFlagTagIds: Set<number> = new Set(
    flags
      .map((name) => V2_FLAG_TAG_IDS[name] as number)
      .filter((id): id is number => typeof id === "number")
  );

  for (const desired of desiredFlagTagIds) {
    if (!currentV2FlagTagIds.has(desired)) {
      try {
        await addTag(cleanSid, desired);
      } catch {
        /* swallow */
      }
    }
  }
  for (const current of currentV2FlagTagIds) {
    if (!desiredFlagTagIds.has(current)) {
      try {
        await removeTag(cleanSid, current);
      } catch {
        /* swallow */
      }
    }
  }
}

interface SetLeadStageInput {
  manychatSubId: string;
  stage: V2PipelineStage;
  flags: V2FlagName[];
  reason?: string;
}

export async function setLeadStage(
  input: SetLeadStageInput
): Promise<SimpleResult> {
  try {
    const cleanSid = input.manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    if (!V2_PIPELINE_STAGES.includes(input.stage)) {
      return { ok: false, error: `invalid stage: ${input.stage}` };
    }
    for (const f of input.flags) {
      if (!(f in V2_FLAG_TAG_IDS)) {
        return { ok: false, error: `invalid flag: ${f}` };
      }
    }

    try {
      await pushStageAndFlags(cleanSid, input.stage, input.flags);
    } catch (e) {
      safeRevalidate("/dashboard/v2", "layout");
      return {
        ok: false,
        error: `כתיבה נכשלה: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: `סטייג ${input.stage} נשמר` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

export async function updateLeadNotes(
  manychatSubId: string,
  notes: string
): Promise<SimpleResult> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    await setCustomFields(cleanSid, [{ name: "notes", value: notes }]);
    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: "ההערות נשמרו" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

/**
 * Stage 4 entry — Eli pushes the final price via dashboard, bot takes over
 * with stage=AWAITING_FINAL and the standard "מתאים?" classifier loop.
 * Per CUSTOMER-FLOW.md v2 §4 (decision: Eli updates stage manually).
 *
 * Side effects:
 *   - leads.pipelineStage = AWAITING_FINAL
 *   - leads.quoteTotal    = price (string)
 *   - leads.botPaused     = false (bot drives Stage 4)
 *   - leads.pipelineFlag  = null  (cleared — bot owns again)
 *   - leads.followUpCount = 0 (fresh cadence window 24/36/72h)
 *   - leads.lastFollowUpAt = now (anchor for next follow-up)
 *   - qState.decisionState / finalState = null (clean slate)
 *   - Sends WhatsApp message: "המחיר הסופי X. נשמח לשמוע את דעתכם על ההצעה."
 */
export async function sendFinalPrice(
  manychatSubId: string,
  price: string
): Promise<SimpleResult> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing subscriberId" };
  const cleanPrice = price.trim();
  if (!cleanPrice) return { ok: false, error: "missing price" };

  try {
    const [row] = await db
      .select({
        sid: leads.manychatSubId,
        jid: leads.waJid,
        qState: leads.qState,
      })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!row) return { ok: false, error: "lead not found" };

    const recipient = row.jid ?? row.sid;
    const message =
      `המחיר הסופי הוא ${cleanPrice} ש"ח.\n\n` +
      `נשמח לשמוע את דעתכם על ההצעה.`;

    // Push WA first — if it fails we don't want to leave DB in the new state.
    await sendBridgeMessage(recipient, message);

    const cleared = {
      ...((row.qState as Record<string, unknown> | null) ?? {}),
      decisionState: null,
      finalState: null,
    };

    await db
      .update(leads)
      .set({
        pipelineStage: "AWAITING_FINAL",
        quoteTotal: cleanPrice,
        followUpCount: 0,
        lastFollowUpAt: new Date(),
        botPaused: false,
        pipelineFlag: null,
        botSummary: "Eli sent final price — awaiting customer decision",
        qState: cleared as any,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);

    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: `המחיר הסופי ${cleanPrice} נשלח` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "send failed",
    };
  }
}

/**
 * Eli sends a manual reply from the dashboard to an escalated (or any) lead.
 * Pauses the bot first so a cron tick won't race the manual message.
 * Logs the outbound to `messages` so the conversation thread stays accurate
 * even if the bridge `message.sent` webhook lags.
 */
export async function sendManualReply(
  manychatSubId: string,
  text: string
): Promise<SimpleResult> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing subscriberId" };
  const cleanText = text.trim();
  if (!cleanText) return { ok: false, error: "missing text" };

  try {
    const [row] = await db
      .select({ jid: leads.waJid, sid: leads.manychatSubId })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!row) return { ok: false, error: "lead not found" };
    const recipient = row.jid ?? row.sid;

    // sendBridgeMessage pre-inserts the outbound row with sender='eli'
    // before the bridge `message.sent` webhook fires, so no extra logging
    // is needed here.
    await sendBridgeMessage(recipient, cleanText, undefined, "eli");

    // Pause bot so cron doesn't pile on; Eli is now driving.
    await db
      .update(leads)
      .set({
        botPaused: true,
        lastFollowUpAt: new Date(),
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);

    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: "נשלח" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "send failed",
    };
  }
}

/**
 * Generate 2-3 Hebrew reply suggestions for an escalated lead. Reads the
 * last 12 messages + bot summary + stage and asks the LLM. Returns the raw
 * suggestions for the dashboard to render — Eli picks/edits/sends.
 */
export async function suggestRepliesAction(
  manychatSubId: string,
  hint?: string
): Promise<{ ok: true; replies: string[] } | { ok: false; error: string }> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing subscriberId" };

  try {
    const [lead] = await db
      .select({
        name: leads.name,
        pipelineStage: leads.pipelineStage,
        botSummary: leads.botSummary,
      })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!lead) return { ok: false, error: "lead not found" };

    const rows = await db
      .select({
        direction: messagesTable.direction,
        text: messagesTable.text,
        receivedAt: messagesTable.receivedAt,
      })
      .from(messagesTable)
      .where(eq(messagesTable.manychatSubId, cleanSid))
      .orderBy(desc(messagesTable.receivedAt))
      .limit(15);

    const recentMessages: ConversationMessage[] = rows
      .filter((r) => r.text && r.text.trim().length > 0)
      .map((r) => ({
        direction: r.direction as "in" | "out",
        text: r.text!,
        at: r.receivedAt?.toISOString(),
      }))
      .reverse();

    const replies = await suggestRepliesLLM({
      recentMessages,
      leadName: lead.name,
      pipelineStage: lead.pipelineStage,
      botSummary: lead.botSummary,
      hint: hint?.trim() || null,
    });

    if (replies.length === 0) {
      return { ok: false, error: "אין הצעות כרגע" };
    }
    return { ok: true, replies };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "suggest failed",
    };
  }
}

/**
 * Snooze a lead — push `last_follow_up_at` forward by N hours so the cron
 * won't nudge until that time. Also clears NEEDS_ELI + un-pauses (Eli is
 * choosing to let the bot drive again, just not immediately).
 */
export async function snoozeLead(
  manychatSubId: string,
  hours: number
): Promise<SimpleResult> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing subscriberId" };
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    return { ok: false, error: "invalid hours (1-168)" };
  }
  try {
    const future = new Date(Date.now() + hours * 60 * 60 * 1000);
    await db
      .update(leads)
      .set({
        lastFollowUpAt: future,
        botPaused: false,
        pipelineFlag: null,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);
    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: `נדחה ב-${hours} שעות` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "snooze failed",
    };
  }
}

// Toggle bot_paused on a lead. Setting paused=false also clears NEEDS_ELI
// and resets the follow-up counter (lead is back in the active loop).
export async function setBotPaused(
  manychatSubId: string,
  paused: boolean
): Promise<SimpleResult> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    if (paused) {
      await db
        .update(leads)
        .set({ botPaused: true, updatedAt: new Date() })
        .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);
    } else {
      await db
        .update(leads)
        .set({
          botPaused: false,
          pipelineFlag: null,
          followUpCount: 0,
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);
    }
    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: paused ? "הבוט מושהה" : "הבוט פעיל" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "toggle failed",
    };
  }
}

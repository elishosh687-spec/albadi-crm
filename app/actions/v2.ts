"use server";

import { db } from "@/lib/db";
import {
  botConfig,
  botDecisionLog,
  botDrafts,
  crmSlaTimers,
  crmTasks,
  factoryQuoteRequests,
  leadTags,
  leadScoreSnapshots,
  leads,
  messageTemplates,
  messages as messagesTable,
  opportunities,
  sourceTouches,
} from "@/drizzle/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
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
import { sendBridgeMessage, sendCtaUrlMessage } from "@/lib/bridge/client";
import { resolveBridgeRecipient } from "@/lib/bridge/jid";
import {
  approveDraft as approveDraftLib,
  rejectDraft as rejectDraftLib,
} from "@/lib/drafts";
import { attachEliFeedback } from "@/lib/supervisor/log";

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

    // Capture prior stage for the supervisor feedback log.
    const [prior] = await db
      .select({ stage: leads.pipelineStage })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);

    try {
      await pushStageAndFlags(cleanSid, input.stage, input.flags);
    } catch (e) {
      safeRevalidate("/dashboard/v3", "layout");
      return {
        ok: false,
        error: `כתיבה נכשלה: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (prior?.stage !== input.stage) {
      await attachEliFeedback({
        manychatSubId: cleanSid,
        eliAction: "stage_override",
        eliStageFrom: prior?.stage ?? null,
        eliStageTo: input.stage,
      });
    }

    safeRevalidate("/dashboard/v3", "layout");
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
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "ההערות נשמרו" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

// Append a timestamped note to leads.notes. Each entry is prefixed with
// [DD/MM/YYYY HH:mm] in Asia/Jerusalem so notes from different days/times
// stay distinguishable. New entries go on TOP so the most recent appears
// first when scanning the field.
export async function appendLeadNote(
  manychatSubId: string,
  text: string
): Promise<{ ok: true; notes: string } | { ok: false; error: string }> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    const cleanText = text.trim();
    if (!cleanText) return { ok: false, error: "missing text" };

    const [row] = await db
      .select({ notes: leads.notes })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!row) return { ok: false, error: "lead not found" };

    const stamp = new Date().toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const entry = `[${stamp}] ${cleanText}`;
    const next = row.notes ? `${entry}\n\n${row.notes}` : entry;

    await setCustomFields(cleanSid, [{ name: "notes", value: next }]);
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, notes: next };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

// Entries always begin with "[<stamp>] " at column 0. Split on the \n\n
// that precedes a "[", so a \n\n inside an entry body doesn't misclassify.
function parseNoteEntries(blob: string): string[] {
  if (!blob) return [];
  return blob.split(/\n\n(?=\[)/g).filter((s) => s.length > 0);
}

// Pull the "[stamp] " prefix off an entry so we can preserve it when the
// user edits the body. Returns { stamp, body } where stamp includes the
// trailing space, or null if the entry doesn't match the expected shape
// (legacy or hand-edited rows).
function splitEntry(entry: string): { stamp: string; body: string } {
  const m = entry.match(/^(\[[^\]]+\]\s*)([\s\S]*)$/);
  if (!m) return { stamp: "", body: entry };
  return { stamp: m[1], body: m[2] };
}

export async function updateLeadNoteAt(
  manychatSubId: string,
  index: number,
  newText: string
): Promise<{ ok: true; notes: string } | { ok: false; error: string }> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    const cleanText = newText.trim();
    if (!cleanText) return { ok: false, error: "missing text" };

    const [row] = await db
      .select({ notes: leads.notes })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!row) return { ok: false, error: "lead not found" };

    const entries = parseNoteEntries(row.notes ?? "");
    if (index < 0 || index >= entries.length) {
      return { ok: false, error: "index out of range" };
    }
    const { stamp } = splitEntry(entries[index]);
    entries[index] = `${stamp}${cleanText}`;
    const next = entries.join("\n\n");

    await setCustomFields(cleanSid, [{ name: "notes", value: next }]);
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, notes: next };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

export async function deleteLeadNoteAt(
  manychatSubId: string,
  index: number
): Promise<{ ok: true; notes: string } | { ok: false; error: string }> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };

    const [row] = await db
      .select({ notes: leads.notes })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!row) return { ok: false, error: "lead not found" };

    const entries = parseNoteEntries(row.notes ?? "");
    if (index < 0 || index >= entries.length) {
      return { ok: false, error: "index out of range" };
    }
    entries.splice(index, 1);
    const next = entries.join("\n\n");

    await setCustomFields(cleanSid, [{ name: "notes", value: next }]);
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, notes: next };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

// Hard-delete a lead and its dependent rows. Order matters because no FK
// CASCADE is declared. bridge_events is intentionally preserved as an
// audit log (it's keyed by evt_id, not lead).
export async function deleteLeadAction(
  manychatSubId: string
): Promise<SimpleResult> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };

    await db.delete(leadTags).where(eq(leadTags.manychatSubId, cleanSid));
    await db.delete(messagesTable).where(eq(messagesTable.manychatSubId, cleanSid));
    await db.delete(botDrafts).where(eq(botDrafts.manychatSubId, cleanSid));
    await db
      .delete(factoryQuoteRequests)
      .where(eq(factoryQuoteRequests.manychatSubId, cleanSid));
    const deleted = await db
      .delete(leads)
      .where(eq(leads.manychatSubId, cleanSid))
      .returning({ sid: leads.manychatSubId });

    if (deleted.length === 0) {
      return { ok: false, error: "lead not found" };
    }

    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "הליד נמחק" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "delete failed",
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
        phone: leads.phoneE164,
        qState: leads.qState,
      })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!row) return { ok: false, error: "lead not found" };

    const recipient = resolveBridgeRecipient({ waJid: row.jid, phoneE164: row.phone });
    if (!recipient) return { ok: false, error: "lead has no waJid or phone" };
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

    safeRevalidate("/dashboard/v3", "layout");
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
      .select({ jid: leads.waJid, sid: leads.manychatSubId, phone: leads.phoneE164 })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!row) return { ok: false, error: "lead not found" };
    const recipient = resolveBridgeRecipient({ waJid: row.jid, phoneE164: row.phone });
    if (!recipient) return { ok: false, error: "lead has no waJid or phone" };

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

    // Supervisor feedback: Eli sent a manual reply via the dashboard composer.
    // If the most recent bot_decision_log row was a supervisor escalation,
    // this attaches the typed text as feedback.
    await attachEliFeedback({
      manychatSubId: cleanSid,
      eliAction: "manual_reply",
      eliManualReply: cleanText,
    });

    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "נשלח" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "send failed",
    };
  }
}

// Conversation thread payload for the inline LeadCard dropdown. Returns the
// most recent messages in ASCENDING order (oldest → newest) so ChatThread can
// render bottom-up without re-sorting.
export interface LeadThreadMessage {
  id: number;
  direction: "in" | "out";
  sender: "lead" | "bot" | "eli" | null;
  text: string | null;
  receivedAt: string;
}

export async function loadLeadThread(
  manychatSubId: string,
  limit = 100
): Promise<
  { ok: true; messages: LeadThreadMessage[] } | { ok: false; error: string }
> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing subscriberId" };
  try {
    const rows = await db
      .select({
        id: messagesTable.id,
        direction: messagesTable.direction,
        sender: messagesTable.sender,
        text: messagesTable.text,
        receivedAt: messagesTable.receivedAt,
      })
      .from(messagesTable)
      .where(sql`trim(${messagesTable.manychatSubId}) = ${cleanSid}`)
      .orderBy(desc(messagesTable.receivedAt))
      .limit(limit);
    const messages = rows.reverse().map((m) => ({
      id: m.id,
      direction: m.direction as "in" | "out",
      sender: (m.sender as "lead" | "bot" | "eli" | null) ?? null,
      text: m.text,
      receivedAt: m.receivedAt.toISOString(),
    }));
    return { ok: true, messages };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "load failed" };
  }
}

// Bot Supervisor Phase 1 — surface bot decision log to the v3 lead drawer.
export interface BotDecisionRowDto {
  id: number;
  createdAt: string;
  manychatSubId: string;
  messageId: number | null;
  inboundText: string | null;
  stageBefore: string | null;
  stageAfter: string | null;
  langfuseTraceId: string | null;
  llmIntent: string | null;
  llmConfidence: number | null;
  llmRecommended: string | null;
  llmReason: string | null;
  llmRiskFlags: string[] | null;
  decidedBy: string;
  action: string;
  replyText: string | null;
  escalationKind: string | null;
  draftId: number | null;
  metadata: Record<string, unknown> | null;
  eliAction: string | null;
  eliCorrectionType: string | null;
  eliEditText: string | null;
  eliRejectReason: string | null;
  eliManualReply: string | null;
  eliStageFrom: string | null;
  eliStageTo: string | null;
  eliDecidedAt: string | null;
}

export async function loadBotDecisionsAction(
  manychatSubId: string,
  limit = 100
): Promise<
  { ok: true; rows: BotDecisionRowDto[] } | { ok: false; error: string }
> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing subscriberId" };
  try {
    const rows = await db
      .select()
      .from(botDecisionLog)
      .where(sql`trim(${botDecisionLog.manychatSubId}) = ${cleanSid}`)
      .orderBy(desc(botDecisionLog.createdAt))
      .limit(limit);
    const dto: BotDecisionRowDto[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      manychatSubId: r.manychatSubId,
      messageId: r.messageId,
      inboundText: r.inboundText,
      stageBefore: r.stageBefore,
      stageAfter: r.stageAfter,
      langfuseTraceId: r.langfuseTraceId,
      llmIntent: r.llmIntent,
      llmConfidence: r.llmConfidence,
      llmRecommended: r.llmRecommended,
      llmReason: r.llmReason,
      llmRiskFlags: r.llmRiskFlags as string[] | null,
      decidedBy: r.decidedBy,
      action: r.action,
      replyText: r.replyText,
      escalationKind: r.escalationKind,
      draftId: r.draftId,
      metadata: r.metadata as Record<string, unknown> | null,
      eliAction: r.eliAction,
      eliCorrectionType: r.eliCorrectionType,
      eliEditText: r.eliEditText,
      eliRejectReason: r.eliRejectReason,
      eliManualReply: r.eliManualReply,
      eliStageFrom: r.eliStageFrom,
      eliStageTo: r.eliStageTo,
      eliDecidedAt: r.eliDecidedAt ? r.eliDecidedAt.toISOString() : null,
    }));
    return { ok: true, rows: dto };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "load failed" };
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
    safeRevalidate("/dashboard/v3", "layout");
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
    await attachEliFeedback({
      manychatSubId: cleanSid,
      eliAction: paused ? "paused" : "unpaused",
    });
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: paused ? "הבוט מושהה" : "הבוט פעיל" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "toggle failed",
    };
  }
}

/**
 * Approve a pending bot draft. Bridge send + DB update happen inside
 * lib/drafts.approveDraft. We just wrap it so the in-app drafts page can
 * call it as a server action without hitting the /api/drafts/:id/approve
 * REST endpoint.
 */
export async function approveDraftAction(
  draftId: number,
  editedText?: string
): Promise<SimpleResult> {
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return { ok: false, error: "invalid draft id" };
  }
  const r = await approveDraftLib(draftId, editedText);
  safeRevalidate("/dashboard/v3/drafts", "layout");
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: "נשלח" };
}

export async function rejectDraftAction(
  draftId: number,
  reason?: string
): Promise<SimpleResult> {
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return { ok: false, error: "invalid draft id" };
  }
  const r = await rejectDraftLib(draftId, reason);
  safeRevalidate("/dashboard/v3/drafts", "layout");
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: "נדחה" };
}

/**
 * Update the name + phone on a lead. Bridge events do not carry contact
 * info for lid-based JIDs, so the supervisor sets them manually as they
 * learn the customer details from the conversation.
 */
export async function updateLeadContactAction(
  manychatSubId: string,
  patch: { name?: string | null; phone?: string | null }
): Promise<SimpleResult> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing subscriberId" };

  const setObj: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const v = patch.name?.trim();
    setObj.name = v ? v : null;
  }
  if (patch.phone !== undefined) {
    const cleanPhone = patch.phone?.replace(/[^\d+]/g, "") ?? "";
    setObj.phoneE164 = cleanPhone ? cleanPhone : null;
  }
  if (Object.keys(setObj).length <= 1) {
    return { ok: false, error: "nothing to update" };
  }
  try {
    await db
      .update(leads)
      .set(setObj as any)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);
    safeRevalidate("/dashboard/v3", "layout");
    safeRevalidate("/dashboard/v3/conversations", "layout");
    return { ok: true, message: "נשמר" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

/**
 * Upsert a single key/value into bot_config. Used by the v3 Settings page
 * for editable prompts and pipeline toggles. The bot does not read these
 * values yet — the table is a holding area until the prompt + toggle
 * integrations follow up. Saving here never breaks production.
 */
export async function saveBotConfigAction(
  key: string,
  value: string
): Promise<SimpleResult> {
  const cleanKey = key.trim();
  if (!cleanKey) return { ok: false, error: "missing key" };
  try {
    await db
      .insert(botConfig)
      .values({ key: cleanKey, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: botConfig.key,
        set: { value, updatedAt: new Date() },
      });
    safeRevalidate("/dashboard/v3/settings", "layout");
    return { ok: true, message: "נשמר" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

export async function createCrmTaskAction(input: {
  manychatSubId: string;
  title: string;
  taskType?: string;
  dueAt?: string | null;
  assignedTo?: string | null;
}): Promise<SimpleResult> {
  try {
    const cleanSid = input.manychatSubId.trim();
    const title = input.title.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    if (!title) return { ok: false, error: "missing title" };
    const due = input.dueAt ? new Date(input.dueAt) : null;
    await db.insert(crmTasks).values({
      manychatSubId: cleanSid,
      title,
      taskType: input.taskType?.trim() || "follow_up",
      dueAt: due && Number.isFinite(due.getTime()) ? due : null,
      assignedTo: input.assignedTo?.trim() || null,
    });
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "משימה נוצרה" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "task failed" };
  }
}

export async function completeCrmTaskAction(taskId: number): Promise<SimpleResult> {
  try {
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return { ok: false, error: "invalid task id" };
    }
    await db
      .update(crmTasks)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(crmTasks.id, taskId));
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "משימה טופלה" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "task failed" };
  }
}

export async function createSlaTimerAction(input: {
  manychatSubId: string;
  slaType: string;
  dueAt: string;
}): Promise<SimpleResult> {
  try {
    const cleanSid = input.manychatSubId.trim();
    const slaType = input.slaType.trim();
    const dueAt = new Date(input.dueAt);
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    if (!slaType) return { ok: false, error: "missing sla type" };
    if (!Number.isFinite(dueAt.getTime())) return { ok: false, error: "invalid dueAt" };
    await db.insert(crmSlaTimers).values({
      manychatSubId: cleanSid,
      slaType,
      dueAt,
    });
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "SLA נוצר" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "sla failed" };
  }
}

export async function resolveSlaTimerAction(timerId: number): Promise<SimpleResult> {
  try {
    if (!Number.isFinite(timerId) || timerId <= 0) {
      return { ok: false, error: "invalid timer id" };
    }
    await db
      .update(crmSlaTimers)
      .set({ resolvedAt: new Date() })
      .where(eq(crmSlaTimers.id, timerId));
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "SLA נסגר" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "sla failed" };
  }
}

export async function saveLeadScoreSnapshotAction(input: {
  manychatSubId: string;
  fitScore: number;
  intentScore: number;
  engagementScore: number;
  frictionPenalty: number;
  reason?: string | null;
}): Promise<SimpleResult> {
  try {
    const cleanSid = input.manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    const scoreTotal = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          input.fitScore +
            input.intentScore +
            input.engagementScore -
            input.frictionPenalty
        )
      )
    );
    const scoreBand =
      scoreTotal >= 75
        ? "HOT"
        : scoreTotal >= 55
          ? "WARM"
          : scoreTotal >= 35
            ? "NURTURE"
            : "LOW";
    await db.insert(leadScoreSnapshots).values({
      manychatSubId: cleanSid,
      fitScore: Math.round(input.fitScore),
      intentScore: Math.round(input.intentScore),
      engagementScore: Math.round(input.engagementScore),
      frictionPenalty: Math.round(input.frictionPenalty),
      scoreTotal,
      scoreBand,
      reason: input.reason?.trim() || null,
    });
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: `ניקוד נשמר: ${scoreTotal}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "score failed" };
  }
}

export async function logSourceTouchAction(input: {
  manychatSubId: string;
  sourcePrimary: string;
  sourceDetail1?: string | null;
  sourceDetail2?: string | null;
  recordSource?: string | null;
}): Promise<SimpleResult> {
  try {
    const cleanSid = input.manychatSubId.trim();
    const sourcePrimary = input.sourcePrimary.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    if (!sourcePrimary) return { ok: false, error: "missing source" };
    await db.insert(sourceTouches).values({
      manychatSubId: cleanSid,
      sourcePrimary,
      sourceDetail1: input.sourceDetail1?.trim() || null,
      sourceDetail2: input.sourceDetail2?.trim() || null,
      recordSource: input.recordSource?.trim() || "dashboard",
    });
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "מקור נשמר" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "source failed" };
  }
}

export async function openOpportunityAction(input: {
  manychatSubId: string;
  valueIls?: number | null;
}): Promise<SimpleResult> {
  try {
    const cleanSid = input.manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    await db.insert(opportunities).values({
      manychatSubId: cleanSid,
      valueIls:
        typeof input.valueIls === "number" && Number.isFinite(input.valueIls)
          ? input.valueIls
          : null,
    });
    safeRevalidate("/dashboard/v3", "layout");
    return { ok: true, message: "Opportunity נפתח" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "opportunity failed" };
  }
}

// ─── Message Templates ────────────────────────────────────────────────────────

export interface TemplateRow {
  id: number;
  name: string;
  type: string;
  body: string;
  headerType: string | null;
  mediaId: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  sortOrder: number;
  active: boolean;
}

export async function listTemplatesAction(): Promise<{
  ok: boolean;
  templates?: TemplateRow[];
  error?: string;
}> {
  try {
    const rows = await db
      .select({
        id: messageTemplates.id,
        name: messageTemplates.name,
        type: messageTemplates.type,
        body: messageTemplates.body,
        headerType: messageTemplates.headerType,
        mediaId: messageTemplates.mediaId,
        ctaLabel: messageTemplates.ctaLabel,
        ctaUrl: messageTemplates.ctaUrl,
        sortOrder: messageTemplates.sortOrder,
        active: messageTemplates.active,
      })
      .from(messageTemplates)
      .orderBy(asc(messageTemplates.sortOrder), asc(messageTemplates.id));
    return { ok: true, templates: rows };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db error" };
  }
}

export async function saveTemplateAction(data: {
  id?: number;
  name: string;
  type: string;
  body: string;
  headerType?: string | null;
  mediaId?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  sortOrder?: number;
}): Promise<SimpleResult> {
  const name = data.name.trim();
  const body = data.body.trim();
  if (!name) return { ok: false, error: "שם חסר" };
  if (!body) return { ok: false, error: "גוף ההודעה חסר" };
  if (!["text", "cta_url"].includes(data.type)) {
    return { ok: false, error: "סוג לא תקין" };
  }
  try {
    const values = {
      name,
      type: data.type,
      body,
      headerType: data.headerType?.trim() || null,
      mediaId: data.mediaId?.trim() || null,
      ctaLabel: data.ctaLabel?.trim() || null,
      ctaUrl: data.ctaUrl?.trim() || null,
      sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
      updatedAt: new Date(),
    };
    if (data.id) {
      await db
        .update(messageTemplates)
        .set(values)
        .where(eq(messageTemplates.id, data.id));
    } else {
      await db.insert(messageTemplates).values(values);
    }
    safeRevalidate("/dashboard/v3/settings", "page");
    return { ok: true, message: "נשמר" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db error" };
  }
}

export async function deleteTemplateAction(id: number): Promise<SimpleResult> {
  try {
    await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
    safeRevalidate("/dashboard/v3/settings", "page");
    return { ok: true, message: "נמחק" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db error" };
  }
}

export async function sendTemplateAction(
  manychatSubId: string,
  templateId: number
): Promise<SimpleResult> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing sid" };
  try {
    const [[leadRow], [tmpl]] = await Promise.all([
      db
        .select({ jid: leads.waJid, phone: leads.phoneE164 })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
        .limit(1),
      db
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.id, templateId))
        .limit(1),
    ]);
    if (!leadRow) return { ok: false, error: "ליד לא נמצא" };
    if (!tmpl) return { ok: false, error: "תבנית לא נמצאת" };
    const jid = leadRow.jid ?? leadRow.phone;
    if (!jid) return { ok: false, error: "אין JID/טלפון לליד" };

    if (tmpl.type === "cta_url") {
      await sendCtaUrlMessage(jid, {
        body: tmpl.body,
        headerType: (tmpl.headerType as "video" | "image" | null) ?? null,
        mediaId: tmpl.mediaId,
        ctaLabel: tmpl.ctaLabel,
        ctaUrl: tmpl.ctaUrl,
      });
    } else {
      await sendBridgeMessage(jid, tmpl.body);
    }
    return { ok: true, message: "נשלח" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "שגיאת שליחה" };
  }
}

/**
 * Bot draft queue — money-moment human-in-the-loop.
 *
 * The autoresponder normally sends LLM-generated replies straight through
 * the bridge. When the lead is in a money-sensitive context (stage gate
 * OR LLM is_money_moment=true) the autoresponder stores the proposed reply
 * here as a `bot_drafts` row in status='pending' instead of sending it. Eli
 * reviews/edits/approves from the Retool supervisor console, which calls
 * approveDraft / rejectDraft to finalize.
 */
import { db } from "@/lib/db";
import { botDrafts, leads } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { resolveBridgeRecipient } from "@/lib/bridge/jid";
import { attachEliFeedback } from "@/lib/supervisor/log";

export type DraftStatus = "pending" | "approved" | "rejected" | "sent" | "failed";

export type MoneyReason =
  | "stage_gate"
  | "discount_request"
  | "price_question"
  | "negotiation"
  | "commitment"
  | "manual";

// Stages where money-moment drafts are queued. Per the 8-stage model:
// INITIAL_QUOTE_SENT covers the bot-driven negotiation/competitor-offer
// sub-states (decisionState in qState); FINAL_QUOTE_SENT and NEGOTIATING
// cover the Eli-driven post-final money conversation.
const MONEY_STAGES = new Set([
  "INITIAL_QUOTE_SENT",
  "FINAL_QUOTE_SENT",
  "NEGOTIATING",
]);

export function isMoneyStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  return MONEY_STAGES.has(stage.toUpperCase());
}

export interface CreateDraftInput {
  manychatSubId: string;
  draftText: string;
  moneyReason: MoneyReason;
  pipelineStageAtGen?: string | null;
  llmConfidence?: number | null;
  triggerMessageId?: number | null;
}

export interface DraftRow {
  id: number;
  manychatSubId: string;
  draftText: string;
  editedText: string | null;
  status: DraftStatus;
  moneyReason: MoneyReason | null;
  llmConfidence: string | null;
  pipelineStageAtGen: string | null;
  triggerMessageId: number | null;
  generatedAt: Date;
  decidedAt: Date | null;
  sentAt: Date | null;
  sentWaMessageId: string | null;
  rejectReason: string | null;
}

export async function createDraft(input: CreateDraftInput): Promise<DraftRow> {
  const sid = input.manychatSubId.trim();
  if (!sid) throw new Error("createDraft: missing manychatSubId");
  if (!input.draftText.trim()) throw new Error("createDraft: missing draftText");

  const [row] = await db
    .insert(botDrafts)
    .values({
      manychatSubId: sid,
      draftText: input.draftText.trim(),
      status: "pending",
      moneyReason: input.moneyReason,
      pipelineStageAtGen: input.pipelineStageAtGen ?? null,
      llmConfidence:
        input.llmConfidence != null ? String(input.llmConfidence) : null,
      triggerMessageId: input.triggerMessageId ?? null,
    })
    .returning();
  return row as DraftRow;
}

export interface PendingFilter {
  limit?: number;
  manychatSubId?: string;
}

export async function getPending(filter: PendingFilter = {}): Promise<DraftRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const rows = filter.manychatSubId
    ? await db
        .select()
        .from(botDrafts)
        .where(
          and(
            eq(botDrafts.status, "pending"),
            sql`trim(${botDrafts.manychatSubId}) = ${filter.manychatSubId.trim()}`
          )
        )
        .orderBy(desc(botDrafts.generatedAt))
        .limit(limit)
    : await db
        .select()
        .from(botDrafts)
        .where(eq(botDrafts.status, "pending"))
        .orderBy(desc(botDrafts.generatedAt))
        .limit(limit);
  return rows as DraftRow[];
}

export async function getDraft(id: number): Promise<DraftRow | null> {
  const [row] = await db
    .select()
    .from(botDrafts)
    .where(eq(botDrafts.id, id))
    .limit(1);
  return (row as DraftRow) ?? null;
}

export interface ApproveResult {
  ok: true;
  draftId: number;
  waMessageId: string;
  sentText: string;
}

export interface ApproveFailure {
  ok: false;
  error: string;
}

/**
 * Approve a draft. If `editedText` is supplied it replaces draftText; either
 * way the chosen text is the body actually sent to the lead. Atomic enough:
 * the bridge send happens first (so a network failure leaves status=pending
 * for retry), DB updates happen only on success, and the outbound message is
 * logged with sender='bot' so the conversation thread reflects authorship.
 */
export async function approveDraft(
  id: number,
  editedText?: string
): Promise<ApproveResult | ApproveFailure> {
  const draft = await getDraft(id);
  if (!draft) return { ok: false, error: "draft not found" };
  if (draft.status !== "pending") {
    return { ok: false, error: `draft is ${draft.status}, not pending` };
  }

  const finalText = (editedText ?? draft.draftText).trim();
  if (!finalText) return { ok: false, error: "empty text" };

  const [leadRow] = await db
    .select({ jid: leads.waJid, sid: leads.manychatSubId, phone: leads.phoneE164 })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${draft.manychatSubId.trim()}`)
    .limit(1);
  if (!leadRow) return { ok: false, error: "lead not found" };
  const recipient = resolveBridgeRecipient({ waJid: leadRow.jid, phoneE164: leadRow.phone });
  if (!recipient) return { ok: false, error: "lead has no waJid or phone" };

  let waMessageId: string;
  try {
    const result = await sendBridgeMessage(recipient, finalText);
    waMessageId = result.wa_message_id;
  } catch (e) {
    await db
      .update(botDrafts)
      .set({
        status: "failed",
        decidedAt: new Date(),
        rejectReason: `send failed: ${e instanceof Error ? e.message : String(e)}`,
      })
      .where(eq(botDrafts.id, id));
    return {
      ok: false,
      error: `bridge send failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const now = new Date();

  await db
    .update(botDrafts)
    .set({
      status: "sent",
      editedText: editedText && editedText !== draft.draftText ? editedText : null,
      decidedAt: now,
      sentAt: now,
      sentWaMessageId: waMessageId,
    })
    .where(eq(botDrafts.id, id));

  // sendBridgeMessage pre-inserts the outbound row with sender='bot', so no
  // explicit messages.insert is needed here. The webhook dedupes by
  // waMessageId, so a later bridge `message.sent` event is a no-op.

  // Bot Supervisor Phase 1: attach Eli's verdict to the most recent decision log row.
  const wasEdited =
    editedText !== undefined &&
    editedText !== null &&
    editedText.trim() !== draft.draftText.trim();
  await attachEliFeedback({
    manychatSubId: draft.manychatSubId,
    eliAction: wasEdited ? "edited_draft" : "approved_as_is",
    eliEditText: wasEdited ? finalText : null,
  });

  return { ok: true, draftId: id, waMessageId, sentText: finalText };
}

export async function rejectDraft(
  id: number,
  reason?: string
): Promise<{ ok: true } | ApproveFailure> {
  const draft = await getDraft(id);
  if (!draft) return { ok: false, error: "draft not found" };
  if (draft.status !== "pending") {
    return { ok: false, error: `draft is ${draft.status}, not pending` };
  }
  await db
    .update(botDrafts)
    .set({
      status: "rejected",
      decidedAt: new Date(),
      rejectReason: reason?.trim() || null,
    })
    .where(eq(botDrafts.id, id));

  await attachEliFeedback({
    manychatSubId: draft.manychatSubId,
    eliAction: "rejected_draft",
    eliRejectReason: reason?.trim() || null,
  });

  return { ok: true };
}

export function isDraftQueueEnabled(): boolean {
  return process.env.ENABLE_DRAFT_QUEUE === "1";
}

/**
 * Generate a draft reply via the existing suggestReplies LLM helper and
 * queue it for Eli's approval. Used by the decision/escalation hooks so
 * money-moment escalations produce a ready-to-send proposal alongside the
 * existing Eli DM. No-op when ENABLE_DRAFT_QUEUE != "1".
 *
 * Returns the created draft id, or null on no-op / failure (this never
 * throws — draft queue is best-effort, escalation flow must not break).
 */
export async function generateAndQueueDraft(input: {
  manychatSubId: string;
  moneyReason: MoneyReason;
  pipelineStage: string | null;
  leadName: string | null;
  botSummary: string | null;
  triggerMessageId?: number | null;
}): Promise<number | null> {
  if (!isDraftQueueEnabled()) return null;

  try {
    // Dynamic imports keep the LLM module out of the cold-start path for
    // builds that don't need it.
    const [{ draftMoneyReply }, { messages }, { db: _db }, { desc, eq }] =
      await Promise.all([
        import("@/lib/autoresponder/suggest-reply"),
        import("@/drizzle/schema"),
        import("@/lib/db"),
        import("drizzle-orm"),
      ]);

    const recent = await _db
      .select({
        direction: messages.direction,
        text: messages.text,
        receivedAt: messages.receivedAt,
      })
      .from(messages)
      .where(eq(messages.manychatSubId, input.manychatSubId.trim()))
      .orderBy(desc(messages.receivedAt))
      .limit(12);

    const conversation = recent
      .filter((r) => r.text && r.text.trim().length > 0)
      .map((r) => ({
        direction: r.direction as "in" | "out",
        text: r.text!,
        at: r.receivedAt?.toISOString(),
      }))
      .reverse();

    const draftText = await draftMoneyReply({
      recentMessages: conversation,
      leadName: input.leadName,
      pipelineStage: input.pipelineStage,
      botSummary: input.botSummary,
      moneyReason: input.moneyReason,
    });
    if (!draftText) return null;

    const draft = await createDraft({
      manychatSubId: input.manychatSubId,
      draftText,
      moneyReason: input.moneyReason,
      pipelineStageAtGen: input.pipelineStage,
      triggerMessageId: input.triggerMessageId ?? null,
    });
    return draft.id;
  } catch (e) {
    console.warn("[generateAndQueueDraft] best-effort failure", e);
    return null;
  }
}

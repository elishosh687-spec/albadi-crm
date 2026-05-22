/**
 * Bot decision log — best-effort writes for the supervisor pipeline.
 *
 * Two entry points:
 *   logDecision()        — called by supervisor / handlers after every inbound.
 *                          One row = one inbound's full decision trace.
 *   attachEliFeedback()  — called later when Eli interacts (draft approve,
 *                          manual reply, stage override, direct WA reply).
 *                          Updates the most recent eligible row for the sid
 *                          (within 24h window). NEVER throws.
 */
import { db } from "../db";
import { botDecisionLog } from "../../drizzle/schema";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

export type DecidedBy =
  | "code"
  | "llm_override"
  | "llm_unmatch"
  | "llm_spec"
  | "eli"
  | "supervisor_error"
  | "silent";

export type DecisionAction =
  | "reply_sent"
  | "sub_state_advanced"
  | "escalated"
  | "stage_transition"
  | "no_op"
  | "paused"
  | "unpaused_on_inbound"
  | "draft_queued";

export type LlmRecommended =
  | "approve_code"
  | "override_with_text"
  | "escalate_to_eli"
  | "silence"
  | "supervisor_error";

export type EliAction =
  | "approved_as_is"
  | "edited_draft"
  | "rejected_draft"
  | "manual_reply"
  | "stage_override"
  | "unpaused"
  | "paused"
  | "direct_whatsapp_reply";

/**
 * Classification of what Eli's correction is ABOUT. Phase 2 rule-mining
 * should only convert routing/policy patterns into deterministic rules.
 * Pure rewording (content) means the bot's decision was correct — only the
 * phrasing differed — so it should NOT become a rule.
 */
export type EliCorrectionType = "routing" | "policy" | "content";

/**
 * Heuristic — infer the correction type when caller didn't supply one.
 * Used so existing call sites don't all need updates.
 */
function inferCorrectionType(input: AttachEliFeedbackInput): EliCorrectionType | null {
  if (input.eliCorrectionType) return input.eliCorrectionType;
  switch (input.eliAction) {
    case "stage_override":
    case "rejected_draft":
    case "paused":
    case "unpaused":
      return "routing";
    case "edited_draft":
      return "content"; // assumption: edits to a draft are usually rewording
    case "manual_reply":
    case "direct_whatsapp_reply":
      return "content"; // typed a fresh reply — usually phrasing-level
    case "approved_as_is":
    default:
      return null;
  }
}

export interface LogDecisionInput {
  manychatSubId: string;
  messageId?: number | null;
  inboundText?: string | null;
  stageBefore?: string | null;
  stageAfter?: string | null;

  langfuseTraceId?: string | null;

  llmIntent?: string | null;
  llmConfidence?: number | null;
  llmRecommended?: LlmRecommended | null;
  llmReason?: string | null;
  llmRiskFlags?: string[] | null;

  decidedBy: DecidedBy;
  action: DecisionAction;
  replyText?: string | null;
  escalationKind?: string | null;
  draftId?: number | null;
  metadata?: Record<string, unknown> | null;
  /** Inbound channel: 'bridge' | 'green' | 'ghl'. Defaults to 'bridge'. */
  source?: string | null;
}

/**
 * Insert a new decision row. Best-effort: logs but never throws so a logging
 * failure can never break the inbound handler.
 */
export async function logDecision(
  input: LogDecisionInput
): Promise<number | null> {
  try {
    const [row] = await db
      .insert(botDecisionLog)
      .values({
        manychatSubId: input.manychatSubId.trim(),
        messageId: input.messageId ?? null,
        inboundText: truncate(input.inboundText, 1000),
        stageBefore: input.stageBefore ?? null,
        stageAfter: input.stageAfter ?? null,
        langfuseTraceId: input.langfuseTraceId ?? null,
        llmIntent: input.llmIntent ?? null,
        llmConfidence: input.llmConfidence ?? null,
        llmRecommended: input.llmRecommended ?? null,
        llmReason: input.llmReason ?? null,
        llmRiskFlags: (input.llmRiskFlags as any) ?? null,
        decidedBy: input.decidedBy,
        action: input.action,
        replyText: truncate(input.replyText, 4000),
        escalationKind: input.escalationKind ?? null,
        draftId: input.draftId ?? null,
        metadata: (input.metadata as any) ?? null,
        source: input.source ?? "bridge",
      })
      .returning({ id: botDecisionLog.id });
    return row?.id ?? null;
  } catch (e) {
    console.warn("[logDecision] best-effort write failed", e);
    return null;
  }
}

export interface AttachEliFeedbackInput {
  manychatSubId: string;
  eliAction: EliAction;
  eliCorrectionType?: EliCorrectionType | null;
  eliEditText?: string | null;
  eliRejectReason?: string | null;
  eliManualReply?: string | null;
  eliStageFrom?: string | null;
  eliStageTo?: string | null;
}

const FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Find the most recent decision row for this lead within FEEDBACK_WINDOW that
 * still has eli_action=NULL, and fill in the eli_* columns. If nothing
 * eligible exists, no-op (Eli acted spontaneously without a prior bot
 * decision — e.g. cold outreach). Best-effort — never throws.
 *
 * Returns the row id updated, or null.
 */
export async function attachEliFeedback(
  input: AttachEliFeedbackInput
): Promise<number | null> {
  try {
    const sid = input.manychatSubId.trim();
    const cutoff = new Date(Date.now() - FEEDBACK_WINDOW_MS);

    const [row] = await db
      .select({ id: botDecisionLog.id })
      .from(botDecisionLog)
      .where(
        and(
          sql`trim(${botDecisionLog.manychatSubId}) = ${sid}`,
          isNull(botDecisionLog.eliAction),
          gt(botDecisionLog.createdAt, cutoff)
        )
      )
      .orderBy(desc(botDecisionLog.createdAt))
      .limit(1);

    if (!row) return null;

    await db
      .update(botDecisionLog)
      .set({
        eliAction: input.eliAction,
        eliCorrectionType: inferCorrectionType(input),
        eliEditText: truncate(input.eliEditText, 4000),
        eliRejectReason: truncate(input.eliRejectReason, 1000),
        eliManualReply: truncate(input.eliManualReply, 4000),
        eliStageFrom: input.eliStageFrom ?? null,
        eliStageTo: input.eliStageTo ?? null,
        eliDecidedAt: new Date(),
      })
      .where(eq(botDecisionLog.id, row.id));

    return row.id;
  } catch (e) {
    console.warn("[attachEliFeedback] best-effort write failed", e);
    return null;
  }
}

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

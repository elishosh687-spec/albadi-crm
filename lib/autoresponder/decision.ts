/**
 * Post-questionnaire decision sub-flow. Aligned to docs/CUSTOMER-FLOW.md.
 *
 * Stage values use the 8-stage journey model from lib/manychat/stages.ts.
 * Internal autoresponder sub-flow is tracked on qState.subFlow:
 *
 *   subFlow="awaiting_estimate_decision"  (stage = INTAKE)
 *     bot asked "המחיר מתאים?"
 *     ├─ accept             → FACTORY_WAIT + subFlow="awaiting_logo"
 *     ├─ samples_request    → catalog URL, stay
 *     ├─ negotiating ("יקר") → ask "יש לך הצעה מתחרה?" (decisionState sub-sub-state)
 *     ├─ reject             → ask "יש סיבה ספציפית?" (decisionState)
 *     ├─ custom_size        → escalate (Eli prices manually)
 *     ├─ question_delivery  → canned 25/90 days, stay
 *     ├─ question_inclusive → canned "כן הכל כלול", stay
 *     ├─ question_payment   → canned 50/50, stay
 *     ├─ question_meeting / question_other → escalate
 *     └─ other              → no-op (cadence keeps nudging)
 *
 *   subFlow="awaiting_logo"  (stage = FACTORY_WAIT)
 *     ├─ media inbound (image / file / link) → subFlow="awaiting_factory_estimate" + NEEDS_ELI + Eli DM
 *     ├─ text + intent=question_format       → canned "כל פורמט בסדר", stay
 *     └─ text (other)                         → re-ask up to 3x, then escalate
 *
 *   subFlow="awaiting_factory_estimate"  (stage = FACTORY_WAIT)
 *     bot is paused — Eli/factory works the price manually.
 *
 *   subFlow="awaiting_final_decision"  (stage = CONSIDERATION)
 *     Eli sent final price; bot watches for customer reaction.
 *
 * Sub-flows respect bot_paused (caller skips this module when paused).
 */
import { db } from "../db";
import { leads, messages as messagesTable } from "../../drizzle/schema";
import { desc, sql, eq } from "drizzle-orm";
import { sendBridgeMessage, sendCompanyTemplate } from "../bridge/client";
import { sendEliDM } from "../notify/eli";
import { classifyIntent, type Intent } from "./intent";
import { handleUnmatch, type UnmatchResult } from "./unmatch-agent";
import { extractSpecFromText, hasAnyField } from "./spec-extractor";
import {
  mergeExtracted,
  requoteWithUpdatedSpec,
  shouldRouteToFactory,
  COMPANY_TEMPLATE,
  type QState,
} from "./questionnaire";
import {
  eliDecisionEscalationTemplate,
  eliLogoReceivedTemplate,
} from "../messaging/templates";
import { generateAndQueueDraft, type MoneyReason } from "../drafts";

const ESCALATION_KIND_TO_MONEY_REASON: Partial<
  Record<"reject" | "negotiating" | "spec_change" | "question" | "generic", MoneyReason>
> = {
  negotiating: "negotiation",
  reject: "discount_request",
  spec_change: "price_question",
};

const CATALOG_URL = "https://albadi.ecobrotherss.com/catalog";

// --- Bot reply copies (Hebrew). Voice: first-person singular Eli, plural
// neutral "you" (אתם/לכם), 0-1 emoji. Source: docs/BOT-COPY.md.
const ACCEPT_REPLY =
  "מעולה! 🎉 שלח לי בבקשה את הלוגו כתמונה כאן בוואטסאפ ונמשיך הלאה.";
const SAMPLES_REPLY = `בטח! הנה הקטלוג שלנו 📚\n${CATALOG_URL}`;
const LOGO_REASK =
  "תודה! 🙏 כדי להמשיך אני צריך גם את הלוגו — אפשר לשלוח כתמונה כאן?";
const LOGO_ESCALATE_REPLY =
  "תודה! 🙏 קיבלתי את ההודעה, אחזור אליכם בקרוב.";
const LOGO_LINK_REPLY =
  "תודה, קיבלתי את הקישור 🙏 פותח ושולח לכם את המחיר הסופי תוך 24 שעות.";
const LOGO_NO_LOGO_REPLY =
  "אין בעיה, אתקשר אליכם לסגור אופציות.";

// Stage 2 sub-flow prompts (§2.3 reject → §2.4 negotiating)
const REPLY_REASON_PROMPT =
  "אוקיי. לפני שאני סוגר — יש סיבה ספציפית? (מחיר, זמן, משהו אחר)";
const REPLY_COMPETITOR_PROMPT =
  "יש לכם הצעה אחרת מול העיניים? אם כן — תגידו לי את המחיר, ננסה להתאים.";
const REPLY_COMPETITOR_ESCALATE_REPLY =
  "תודה. אני צריך כמה שעות לבדוק את זה — חוזר אליכם היום-מחר.";
const REPLY_PAUSE_PROMPT =
  "מה ספציפית צריך לחשוב עליו? תכתבו לי, אולי אוכל לעזור.";
const REPLY_PAUSE_ACK =
  "סבבה, קחו את הזמן. אם תרצו לפני זה — תכתבו לי.";
const REPLY_COMPETITOR_AMBIGUOUS_ACK =
  "סבבה, אתקשר אליכם.";

// Stage 2 / 3 / 4 canned answers (values from BOT-COPY.md §2.6 / 3.4 / 4.4)
const REPLY_DELIVERY = "אקספרס 25 יום, רגיל 90 יום (מהאישור).";
const REPLY_INCLUSIVE =
  "הכל כלול — שקיות, הדפסה, משלוח.";
const REPLY_PAYMENT =
  "50% בעת ההזמנה, 50% לפני שהסחורה יוצאת מהמפעל. רוצים לסגור?";
const REPLY_LOGO_FORMAT = "כל פורמט בסדר. שלחו מה שיש.";
const REPLY_CALL_REQUEST = "בטח. אתקשר אליכם בקרוב.";
const REPLY_ORDER_TO_PHONE = "זה כבר בטלפון. אתקשר אליכם היום.";

// Stage 2 §2.5 — spec change in preliminary stage
const REPLY_SPEC_CHANGE_ASK =
  "אין בעיה. מה תרצו לשנות?\n\n📦 כמות (לדוגמה: 1500 / 2500)\n📐 מידה\n🛍️ ידיות (עם / בלי)\n✨ למינציה (עם / בלי)\n🎨 צבעי הדפסה\n\nתכתבו חופשי בעברית.";
const REPLY_SPEC_CHANGE_ACK =
  "מעולה, יש לי את הפרטים. חוזר אליכם תוך 24 שעות עם הצעה מעודכנת.";
// New (LLM rewrite of spec-change handler) — sent when the LLM couldn't
// extract a single actionable field from the customer's reply. Re-prompts
// with the same parameter list. After 2 strikes we escalate.
const REPLY_SPEC_CHANGE_REPROMPT =
  "לא בטוח שהבנתי מה תרצו לשנות. אפשר לכתוב שוב — איזה פרמטר ובאיזה ערך?\nלדוגמה:\n• \"תעשו 2500 יחידות\"\n• \"בלי ידיות\"\n• \"3 צבעים במקום 2\"\n• \"מידה 30×40 ס\"מ\"";
// Auto-quote reply when the LLM-extracted spec lands in the calculator's
// range (≥1000 units, no custom dimensions). The new quote follows on the
// next line via the existing routeToQuoted message.
const REPLY_SPEC_CHANGE_AUTO_QUOTE =
  "סבבה, עדכנתי את הפרטים. הנה ההצעה המעודכנת:";

// CONSIDERATION (subFlow=awaiting_final_decision) copies
const FINAL_ACCEPT_REPLY =
  "מעולה 🎉 אתקשר אליכם תוך כמה שעות עם פרטי תשלום ולוחות זמנים.";
const FINAL_HAGGLE_PROMPT =
  "אוקיי, מה בדיוק לא מתאים? המחיר, התנאים, או משהו אחר?";
const FINAL_DISCOUNT_ESCALATE_REPLY =
  "אבדוק מה אוכל לעשות ואחזור אליכם.";
const FINAL_SPEC_CHANGE_REPLY =
  "סבבה. נעבור על השאלון שוב לעדכן מחיר.";

interface LeadCtx {
  sid: string;
  jid: string;
  name: string | null;
  phone: string | null;
  pipelineStage: string | null;
  qState: any;
  followUpCount: number;
}

async function loadLeadCtx(sid: string): Promise<LeadCtx | null> {
  const [row] = await db
    .select({
      sid: leads.manychatSubId,
      jid: leads.waJid,
      name: leads.name,
      phone: leads.phoneE164,
      pipelineStage: leads.pipelineStage,
      qState: leads.qState,
      followUpCount: leads.followUpCount,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  if (!row) return null;
  // Prefer waJid, then phone→JID. Never fall back to sid: for ManyChat-origin
  // leads sid is a subscriber id, not a phone, so phoneToJid(sid) would synth
  // a non-existent JID and sends would silently route to nowhere.
  const jid = row.jid ?? (row.phone ? `${row.phone.replace(/[^0-9]/g, "")}@s.whatsapp.net` : null);
  if (!jid) return null;
  return {
    sid: row.sid,
    jid,
    name: row.name,
    phone: row.phone,
    pipelineStage: row.pipelineStage,
    qState: row.qState,
    followUpCount: row.followUpCount,
  };
}

async function loadRecentMessages(
  sid: string,
  limit = 8
): Promise<{ direction: "in" | "out"; text: string }[]> {
  const rows = await db
    .select({ direction: messagesTable.direction, text: messagesTable.text })
    .from(messagesTable)
    .where(eq(messagesTable.manychatSubId, sid.trim()))
    .orderBy(desc(messagesTable.receivedAt))
    .limit(limit);
  return rows
    .filter((r) => r.text)
    .map((r) => ({ direction: r.direction as "in" | "out", text: r.text! }))
    .reverse();
}

async function setDecisionState(
  sid: string,
  decisionState: string | null,
  currentQState: any
): Promise<void> {
  const next = { ...(currentQState ?? {}), decisionState };
  await db
    .update(leads)
    .set({ qState: next as any, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`);
}

/**
 * Escalate the lead to Eli — sets NEEDS_ELI + bot_paused, fires a DM, optionally
 * queues a money-moment draft.
 *
 * Two call shapes are supported (backward compat — many call sites still use
 * the positional form):
 *
 *   // legacy (positional)
 *   escalateToEli(ctx, reason, llmSummary, kind)
 *
 *   // enriched (options object) — preferred when LLM was in the path
 *   escalateToEli(ctx, reason, { kind, llmAnalysis, recommendation, llmSummary })
 *
 * `llmAnalysis` / `recommendation` come from unmatch-agent or spec-extractor and
 * land in Eli's DM verbatim. `llmSummary` (legacy) is kept as a fallback line
 * when neither analysis nor recommendation is provided.
 */
interface EscalateOptions {
  kind?: "reject" | "negotiating" | "spec_change" | "question" | "generic";
  /** Legacy short summary written into bot_summary + DM fallback line. */
  llmSummary?: string | null;
  /** LLM's reading of what the customer wants (Hebrew). */
  llmAnalysis?: string | null;
  /** LLM's recommended next move (Hebrew). */
  recommendation?: string | null;
}

async function escalateToEli(
  ctx: LeadCtx,
  reason: string,
  optsOrSummary?: EscalateOptions | string,
  legacyKind: "reject" | "negotiating" | "spec_change" | "question" | "generic" = "generic"
): Promise<void> {
  // Normalize the two signatures into a single opts struct.
  const opts: EscalateOptions =
    typeof optsOrSummary === "string"
      ? { llmSummary: optsOrSummary, kind: legacyKind }
      : { kind: legacyKind, ...(optsOrSummary ?? {}) };
  const kind = opts.kind ?? "generic";

  // bot_summary stays short and human-readable for the dashboard. Prefer the
  // richer LLM analysis when it exists; otherwise fall back to legacy summary.
  const botSummary =
    opts.llmAnalysis?.trim() || opts.llmSummary?.trim() || reason;

  // Clear any decision sub-state when escalating so re-engagement starts clean.
  const cleared = { ...(ctx.qState ?? {}), decisionState: null };
  await db
    .update(leads)
    .set({
      pipelineFlag: "NEEDS_ELI",
      botPaused: true,
      botSummary,
      qState: cleared as any,
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
  await sendEliDM(
    eliDecisionEscalationTemplate({
      name: ctx.name,
      phone: ctx.phone,
      stage: ctx.pipelineStage,
      kind,
      summary: opts.llmSummary ?? null,
      llmAnalysis: opts.llmAnalysis ?? null,
      recommendation: opts.recommendation ?? null,
    })
  );

  // Money-moment hook: queue a draft reply for the Retool supervisor console
  // (no-op when ENABLE_DRAFT_QUEUE != "1"). Only fires for money-related
  // escalation kinds; pure "question" / "generic" escalations skip this.
  const moneyReason = ESCALATION_KIND_TO_MONEY_REASON[kind];
  if (moneyReason) {
    await generateAndQueueDraft({
      manychatSubId: ctx.sid,
      moneyReason,
      pipelineStage: ctx.pipelineStage,
      leadName: ctx.name,
      botSummary,
    });
  }
}

function hasDigits(text: string): boolean {
  return /\d/.test(text);
}

/**
 * Run the unmatch agent and apply its decision: send a reply, escalate with
 * rich context, or no-op. Returns the agent's verdict so the caller can fold
 * it into its own DecisionResult.
 *
 * Used by the three "we don't know what to do" branches:
 *   - intent === "other"
 *   - intent === "question_other"
 *   - awaiting_competitor_offer with no digits + not a clear reject
 *
 * `fallbackEscalateReason` runs when the agent says "escalate" but didn't
 * provide an analysis — keeps a sensible bot_summary line in the dashboard.
 */
async function runUnmatchAgent(
  ctx: LeadCtx,
  message: string,
  reasonLabel: string,
  fallbackEscalateReason: string,
  fallbackKind: "reject" | "negotiating" | "spec_change" | "question" | "generic" = "generic"
): Promise<UnmatchResult> {
  let result: UnmatchResult;
  try {
    result = await handleUnmatch({
      sid: ctx.sid,
      message,
      reason: reasonLabel,
    });
  } catch (e) {
    console.error("[decision] unmatch agent threw", e);
    // Treat any thrown error as an escalation — same as the agent's own
    // soft-fail path.
    result = {
      action: "escalate",
      kind: fallbackKind,
      llmAnalysis: `הבוט לא הצליח לסווג: "${message.slice(0, 120)}"`,
      recommendation: undefined,
      confidence: 0,
    };
  }

  if (result.action === "reply" && result.replyText) {
    await sendBridgeMessage(ctx.jid, result.replyText);
    return result;
  }
  if (result.action === "escalate") {
    await escalateToEli(ctx, fallbackEscalateReason, {
      kind: result.kind ?? fallbackKind,
      llmAnalysis: result.llmAnalysis,
      recommendation: result.recommendation,
    });
    return result;
  }
  // noop — let cadence handle.
  return result;
}

/**
 * Render an LLM-extracted spec change as a short Hebrew clause for the DM
 * to Eli ("ביקש לשנות: כמות → 2500, ידיות → לא"). Skips undefined fields.
 */
function describeSpecChange(extracted: {
  shipping?: string;
  quantity?: string;
  quantityCustom?: string;
  product?: string;
  productCustom?: string;
  handles?: string;
  lamination?: string;
  colors?: string;
  notes?: string;
}): string {
  const parts: string[] = [];
  if (extracted.shipping) {
    parts.push(
      `משלוח → ${extracted.shipping === "s1" ? "אקספרס" : "רגיל"}`
    );
  }
  if (extracted.quantity) {
    const q =
      extracted.quantity === "custom"
        ? extracted.quantityCustom ?? "אחר"
        : extracted.quantity;
    parts.push(`כמות → ${q}`);
  }
  if (extracted.product) {
    const p =
      extracted.product === "custom"
        ? extracted.productCustom ?? "מידה מיוחדת"
        : extracted.product;
    parts.push(`מידה → ${p}`);
  }
  if (extracted.handles) {
    parts.push(`ידיות → ${extracted.handles === "true" ? "כן" : "לא"}`);
  }
  if (extracted.lamination) {
    parts.push(
      `למינציה → ${extracted.lamination === "true" ? "כן" : "לא"}`
    );
  }
  if (extracted.colors) {
    parts.push(`צבעים → ${extracted.colors}`);
  }
  if (extracted.notes) {
    parts.push(`הערה: ${extracted.notes}`);
  }
  return parts.length ? parts.join(", ") : "ללא פירוט";
}

// File-share URL detection for logo-stage inbounds. Match Drive / Dropbox /
// WeTransfer / OneDrive / Box and the most common generic shorteners. The
// regex is permissive — we only need to know that the customer dropped
// *something* shareable, the actual content review is manual.
const LOGO_LINK_RE =
  /https?:\/\/(?:\S*\.)?(?:drive\.google\.com|docs\.google\.com|dropbox\.com|wetransfer\.com|we\.tl|onedrive\.live\.com|1drv\.ms|box\.com|icloud\.com|mega\.nz|sendgb\.com|filemail\.com)\b/i;
function hasLogoLink(text: string): boolean {
  return LOGO_LINK_RE.test(text);
}

export interface DecisionResult {
  action:
    | "no_op"
    | "accept_routed"
    | "samples_sent"
    | "canned_reply"
    | "sub_state_advanced"
    | "escalated"
    | "logo_received"
    | "logo_reasked"
    | "won_routed";
  intent?: Intent;
  detail?: string;
}

/**
 * Handle inbound for a lead in one of the post-quote autoresponder sub-flows.
 * Routes by qState.subFlow (set when entering each sub-flow); falls back to
 * deriving from pipeline_stage for leads written before the subFlow refactor.
 * Returns no_op for anything outside the autoresponder's scope.
 */
export async function handleDecisionInbound(input: {
  sid: string;
  text: string | null;
  hasMedia: boolean;
}): Promise<DecisionResult> {
  const ctx = await loadLeadCtx(input.sid);
  if (!ctx) return { action: "no_op", detail: "no lead row" };

  const stage = (ctx.pipelineStage ?? "").toUpperCase();
  const subFlow =
    ((ctx.qState as Record<string, unknown> | null)?.subFlow as string | undefined) ?? null;

  // subFlow is authoritative when present.
  if (subFlow === "awaiting_logo") {
    return handleLogoStage(ctx, input.text, input.hasMedia);
  }
  if (subFlow === "awaiting_estimate_decision") {
    return handleDecisionStage(ctx, input.text);
  }
  if (subFlow === "awaiting_final_decision") {
    return handleFinalStage(ctx, input.text);
  }

  // Fallback for leads written before subFlow existed. FACTORY_WAIT without
  // a subFlow most commonly means awaiting_logo (the bot-driven happy path);
  // awaiting_factory_estimate is set explicitly elsewhere.
  if (stage === "FACTORY_WAIT") {
    return handleLogoStage(ctx, input.text, input.hasMedia);
  }
  if (stage === "INTAKE") {
    return handleDecisionStage(ctx, input.text);
  }
  if (stage === "CONSIDERATION") {
    return handleFinalStage(ctx, input.text);
  }
  return { action: "no_op", detail: `stage=${stage} subFlow=${subFlow}` };
}

async function handleDecisionStage(
  ctx: LeadCtx,
  text: string | null
): Promise<DecisionResult> {
  const t = (text ?? "").trim();
  if (!t) {
    // Empty text at INTAKE = customer sent media without
    // caption (e.g. they accepted the quote and sent a logo eagerly, or
    // a voice note / sticker). The bot can't classify, but silence makes
    // the customer feel ignored. Escalate so Eli sees it in the
    // dashboard and can reply manually.
    await escalateToEli(ctx, "Customer sent media-only / empty message after quote", {
      kind: "generic",
      llmAnalysis:
        "הלקוח שלח הודעה בלי טקסט (תמונה / קובץ / הקלטה) אחרי שקיבל הצעת מחיר. ייתכן שזה הלוגו או שאלה במדיה.",
      recommendation: "לבדוק את ההודעה במדיה ולענות ידנית.",
    });
    return { action: "escalated", detail: "empty text inbound → escalated" };
  }

  const decisionState: string | null = ctx.qState?.decisionState ?? null;
  const recent = await loadRecentMessages(ctx.sid);
  const classification = await classifyIntent({
    inboundText: t,
    recentMessages: recent,
    leadName: ctx.name,
    pipelineStage: ctx.pipelineStage,
  });

  // --- Sub-state branches first ---
  if (decisionState === "awaiting_reason") {
    // §2.2 — bot asked "יש סיבה?", listening for "יקר" (→ 2.3) vs other (→ escalate).
    if (
      classification.intent === "negotiating" ||
      /יקר|מחיר/.test(t)
    ) {
      await setDecisionState(ctx.sid, "awaiting_competitor_offer", ctx.qState);
      await sendBridgeMessage(ctx.jid, REPLY_COMPETITOR_PROMPT);
      return {
        action: "sub_state_advanced",
        intent: classification.intent,
        detail: "reason=price → awaiting_competitor_offer",
      };
    }
    await escalateToEli(
      ctx,
      "הלקוח דחה את ההצעה — סיבה לא מבוססת-מחיר",
      classification.summary,
      "reject"
    );
    return {
      action: "escalated",
      intent: classification.intent,
      detail: "non-price reject reason",
    };
  }

  if (decisionState === "awaiting_competitor_offer") {
    // §2.3 — bot asked "יש לך הצעה מתחרה?".
    //   • text mentions a number / mentions price / intent=negotiating → escalate (Eli decides)
    //   • intent=reject ("לא") → ask "מה מטריד?" (awaiting_pause_reason)
    //   • else → escalate (ambiguous answer)
    if (hasDigits(t) || classification.intent === "negotiating") {
      // §2.4.2 — customer gave a competitor price. Acknowledge politely, then escalate.
      await sendBridgeMessage(ctx.jid, REPLY_COMPETITOR_ESCALATE_REPLY);
      await escalateToEli(
        ctx,
        "הלקוח נתן מחיר/הצעה מתחרה",
        classification.summary ?? t.slice(0, 120),
        "negotiating"
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: "competitor_offer with price",
      };
    }
    if (classification.intent === "reject") {
      await setDecisionState(ctx.sid, "awaiting_pause_reason", ctx.qState);
      await sendBridgeMessage(ctx.jid, REPLY_PAUSE_PROMPT);
      return {
        action: "sub_state_advanced",
        intent: classification.intent,
        detail: "no competitor → awaiting_pause_reason",
      };
    }
    // §2.4.4B — previously: ambiguous reply → instant escalate with an ack.
    // Now: try the unmatch agent first. It might understand "לא ממש, אבל
    // יקר לי" as a soft no-competitor reply that we can route to the pause
    // sub-state, or it might confirm an escalation with a richer summary.
    const agentResult = await runUnmatchAgent(
      ctx,
      t,
      "Stage 2 — customer answered awaiting_competitor_offer ambiguously",
      "הלקוח ענה תשובה לא ברורה על הצעה מתחרה",
      "negotiating"
    );
    if (agentResult.action === "reply") {
      return {
        action: "canned_reply",
        intent: classification.intent,
        detail: "competitor_ambiguous → llm-handled",
      };
    }
    if (agentResult.action === "escalate") {
      return {
        action: "escalated",
        intent: classification.intent,
        detail: agentResult.llmAnalysis ?? "ambiguous competitor reply",
      };
    }
    // Agent said noop — preserve the original behavior with the polite ack
    // so the customer isn't ghosted.
    await sendBridgeMessage(ctx.jid, REPLY_COMPETITOR_AMBIGUOUS_ACK);
    return {
      action: "no_op",
      intent: classification.intent,
      detail: "competitor ambiguous, agent said noop",
    };
  }

  if (decisionState === "awaiting_spec_change") {
    // §2.5.2 — customer described what to change. The LLM tries to extract
    // canonical fields:
    //   - At least one field extracted + new state is calculator-safe (no
    //     custom dims, qty ≥ 1000) → auto-requote, no Eli.
    //   - At least one field extracted + new state still requires manual
    //     pricing (custom dims / sub-tier qty) → escalate with rich summary
    //     of WHAT changed (not a generic "wanted spec change").
    //   - No field extracted (customer asked a question, garbled text) →
    //     re-prompt with the parameter list. After 2 strikes, escalate.
    const currentQState: QState = (ctx.qState ?? {}) as QState;
    const extracted = await extractSpecFromText({ text: t });
    const hasField = extracted ? hasAnyField(extracted) : false;

    if (!hasField) {
      const attempts = (currentQState.specChangeAttempts ?? 0) + 1;
      if (attempts >= 2) {
        await escalateToEli(ctx, "Lead couldn't articulate spec change", {
          kind: "spec_change",
          llmAnalysis:
            "הלקוח לא הצליח לנסח אילו פרמטרים הוא רוצה לשנות אחרי 2 ניסיונות הבהרה",
          recommendation: "להתקשר ולתאם ידנית. הסיווג הקודם הוצע: שינוי מפרט.",
        });
        return {
          action: "escalated",
          intent: classification.intent,
          detail: "spec_change clarify exhausted",
        };
      }
      const bumped = { ...currentQState, specChangeAttempts: attempts };
      await db
        .update(leads)
        .set({ qState: bumped as any, updatedAt: new Date() })
        .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
      await sendBridgeMessage(ctx.jid, REPLY_SPEC_CHANGE_REPROMPT);
      return {
        action: "sub_state_advanced",
        intent: classification.intent,
        detail: `spec_change reprompt ${attempts}/2`,
      };
    }

    // Got something extractable — merge into qState.
    const { merged } = mergeExtracted(currentQState, extracted!);
    // Clear sub-state + counter as we resolve this turn.
    merged.specChangeAttempts = 0;
    const cleared: QState = { ...merged, decisionState: null } as QState & {
      decisionState: null;
    };

    if (shouldRouteToFactory(cleared)) {
      // New spec still needs Eli (custom dims, sub-tier qty). Persist the
      // merged values for Eli's reference, then escalate with a structured
      // analysis of WHAT changed.
      await db
        .update(leads)
        .set({
          qState: cleared as any,
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);

      const changedSummary = describeSpecChange(extracted!);
      await sendBridgeMessage(ctx.jid, REPLY_SPEC_CHANGE_ACK);
      await escalateToEli(ctx, "spec change requires manual pricing", {
        kind: "spec_change",
        llmAnalysis: `הלקוח ביקש לשנות: ${changedSummary}`,
        recommendation:
          "לתמחר ידנית את המפרט המעודכן ולהחזיר הצעה ללקוח.",
      });
      return {
        action: "escalated",
        intent: classification.intent,
        detail: `spec_change → factory: ${changedSummary}`,
      };
    }

    // Auto-requote — new spec is inside the calculator's range.
    await sendBridgeMessage(ctx.jid, REPLY_SPEC_CHANGE_AUTO_QUOTE);
    const ok = await requoteWithUpdatedSpec({
      sid: ctx.sid,
      jid: ctx.jid,
      state: cleared,
    });
    if (!ok) {
      // Calc failed — fall back to escalation so the customer gets a real
      // human follow-up rather than silent dead-end.
      await escalateToEli(ctx, "auto-requote after spec change failed", {
        kind: "spec_change",
        llmAnalysis: `הלקוח ביקש שינוי (${describeSpecChange(extracted!)}) — המחשבון נכשל`,
        recommendation: "לבדוק את המפרט החדש ולתמחר ידנית.",
      });
      return {
        action: "escalated",
        intent: classification.intent,
        detail: "requote failed",
      };
    }
    return {
      action: "canned_reply",
      intent: classification.intent,
      detail: `spec_change auto-requoted: ${describeSpecChange(extracted!)}`,
    };
  }

  if (decisionState === "awaiting_pause_reason") {
    // §2.4.4A — customer answered "what's blocking?". Acknowledge politely;
    // clear sub-state so cadence can pick up at the normal 24/36/72h.
    await setDecisionState(ctx.sid, null, ctx.qState);
    await sendBridgeMessage(ctx.jid, REPLY_PAUSE_ACK);
    return {
      action: "sub_state_advanced",
      intent: classification.intent,
      detail: "pause reason captured, cadence will follow up",
    };
  }

  // --- Fresh inbound (no sub-state) ---
  switch (classification.intent) {
    case "accept": {
      const cleared = {
        ...(ctx.qState ?? {}),
        decisionState: null,
        subFlow: "awaiting_logo",
      };
      await db
        .update(leads)
        .set({
          // Per Eli 2026-07-01: acceptance on WhatsApp is not enough to
          // advance the stage — sub-flow tracks "awaiting_logo" internally,
          // but pipeline stays at קליטה until Eli confirms.
          pipelineStage: "INTAKE",
          followUpCount: 0,
          lastFollowUpAt: new Date(),
          botSummary: "customer accepted quote — awaiting logo",
          qState: cleared as any,
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
      await sendBridgeMessage(ctx.jid, ACCEPT_REPLY);
      return { action: "accept_routed", intent: classification.intent };
    }

    case "samples_request": {
      await sendBridgeMessage(ctx.jid, SAMPLES_REPLY);
      return { action: "samples_sent", intent: classification.intent };
    }

    case "negotiating": {
      // §2.3 — customer said "יקר" / wants discount up-front. Skip "is there a reason?"
      // and go straight to the competitor-offer question.
      await setDecisionState(ctx.sid, "awaiting_competitor_offer", ctx.qState);
      await sendBridgeMessage(ctx.jid, REPLY_COMPETITOR_PROMPT);
      return {
        action: "sub_state_advanced",
        intent: classification.intent,
        detail: "negotiating → awaiting_competitor_offer",
      };
    }

    case "reject": {
      // §2.2 — ask "יש סיבה?".
      await setDecisionState(ctx.sid, "awaiting_reason", ctx.qState);
      await sendBridgeMessage(ctx.jid, REPLY_REASON_PROMPT);
      return {
        action: "sub_state_advanced",
        intent: classification.intent,
        detail: "reject → awaiting_reason",
      };
    }

    case "question_delivery": {
      await sendBridgeMessage(ctx.jid, REPLY_DELIVERY);
      return { action: "canned_reply", intent: classification.intent, detail: "delivery" };
    }
    case "question_inclusive": {
      await sendBridgeMessage(ctx.jid, REPLY_INCLUSIVE);
      return { action: "canned_reply", intent: classification.intent, detail: "inclusive" };
    }
    case "question_payment": {
      // §R9 — at Stage 2 (preliminary quote) "איך מזמינים / משלמים" is premature.
      // Tell the customer Eli will call to handle ordering, then escalate.
      // (At Stage 4 the same intent gets the 50/50 canned answer — see handleFinalStage.)
      await sendBridgeMessage(ctx.jid, REPLY_ORDER_TO_PHONE);
      await escalateToEli(
        ctx,
        "הלקוח שאל איך מזמינים / משלמים בשלב 2 — לפני מחיר סופי",
        classification.summary,
        "question"
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: "premature payment question",
      };
    }

    case "custom_size": {
      // §2.5 — ask what they want to change first; the answer is captured
      // on the next turn (awaiting_spec_change) → ack + escalate.
      await setDecisionState(ctx.sid, "awaiting_spec_change", ctx.qState);
      await sendBridgeMessage(ctx.jid, REPLY_SPEC_CHANGE_ASK);
      return {
        action: "sub_state_advanced",
        intent: classification.intent,
        detail: "custom_size → awaiting_spec_change",
      };
    }
    case "question_meeting": {
      // §R12 — give the customer a polite ack so they know a call is coming.
      await sendBridgeMessage(ctx.jid, REPLY_CALL_REQUEST);
      await escalateToEli(
        ctx,
        "הלקוח ביקש לדבר עם בן-אדם / פגישה",
        classification.summary,
        "question"
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: classification.summary,
      };
    }
    case "question_other": {
      // Previously: instant escalate. Now: let the unmatch agent try to
      // answer from FAQ first; only escalate if the agent decides it can't.
      const agentResult = await runUnmatchAgent(
        ctx,
        t,
        "Stage 2 — customer asked a question the bot can't auto-answer",
        "הלקוח שאל שאלה שהבוט לא יכול לענות עליה",
        "question"
      );
      if (agentResult.action === "reply") {
        return {
          action: "canned_reply",
          intent: classification.intent,
          detail: "question_other → llm-answered",
        };
      }
      if (agentResult.action === "escalate") {
        return {
          action: "escalated",
          intent: classification.intent,
          detail: agentResult.llmAnalysis ?? classification.summary,
        };
      }
      // Previously: silent no_op when the agent declined to reply. Per
      // the operator request: never go silent post-quote — escalate so
      // the lead surfaces in the dashboard with NEEDS_ELI.
      await escalateToEli(
        ctx,
        "Customer asked a question we couldn't auto-answer",
        {
          kind: "question",
          llmAnalysis: classification.summary ?? agentResult.llmAnalysis ?? null,
          recommendation: "לענות ללקוח ידנית מה-CRM.",
        }
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: "question_other agent noop → escalated",
      };
    }
    case "question_format": {
      // Format question makes more sense at subFlow=awaiting_logo, but if it lands here,
      // answer it anyway so the customer isn't ignored.
      await sendBridgeMessage(ctx.jid, REPLY_LOGO_FORMAT);
      return { action: "canned_reply", intent: classification.intent, detail: "format" };
    }
    case "question_company": {
      // Customer is verifying who we are — send the about-us card again.
      // Same content the customer saw right after the quote; rendering as
      // a separate message keeps the link previews crisp.
      await sendCompanyTemplate(ctx.jid);
      return {
        action: "canned_reply",
        intent: classification.intent,
        detail: "company info sent on-demand",
      };
    }

    case "other":
    default: {
      // Previously: no_op while cron nudges. Now: hand to the unmatch agent —
      // it might understand a compound message ("אקח 1000 כמה יורד?") that
      // the simple 12-category classifier flagged as "other".
      const agentResult = await runUnmatchAgent(
        ctx,
        t,
        "Stage 2 — intent=other, unclassified message",
        "הודעה לא מסווגת מהלקוח"
      );
      if (agentResult.action === "reply") {
        return {
          action: "canned_reply",
          intent: classification.intent,
          detail: "other → llm-handled",
        };
      }
      if (agentResult.action === "escalate") {
        return {
          action: "escalated",
          intent: classification.intent,
          detail: agentResult.llmAnalysis ?? "ambiguous",
        };
      }
      // Previously: silent no_op when the unmatch-agent declined. Per
      // operator request: never go silent post-quote — escalate so the
      // lead surfaces in the dashboard with NEEDS_ELI.
      await escalateToEli(
        ctx,
        "Customer sent an unclassified message after quote",
        {
          kind: "generic",
          llmAnalysis: agentResult.llmAnalysis ?? `הודעה: "${t.slice(0, 120)}"`,
          recommendation: "לבדוק ולענות ידנית מה-CRM.",
        }
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: "other agent noop → escalated",
      };
    }
  }
}

async function handleLogoStage(
  ctx: LeadCtx,
  text: string | null,
  hasMedia: boolean
): Promise<DecisionResult> {
  if (hasMedia) {
    const next = { ...(ctx.qState ?? {}), subFlow: "awaiting_factory_estimate" };
    await db
      .update(leads)
      .set({
        qState: next as any,
        // Per Eli 2026-07-01: bot never advances stage on WA signals alone;
        // stage stays קליטה, Eli moves it manually after reviewing the DM.
        pipelineStage: "INTAKE",
        pipelineFlag: "NEEDS_ELI",
        botPaused: true,
        botSummary: "logo received — Eli to send final price within 24h",
        followUpCount: 0,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
    // Include the preliminary quote in the DM so Eli has context to send the
    // final price quickly.
    const [row] = await db
      .select({ quoteTotal: leads.quoteTotal })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`)
      .limit(1);
    await sendEliDM(
      eliLogoReceivedTemplate({
        name: ctx.name,
        phone: ctx.phone,
        quotePrice: row?.quoteTotal ?? null,
      })
    );
    await sendBridgeMessage(ctx.jid, LOGO_ESCALATE_REPLY);
    return { action: "logo_received" };
  }

  const t = (text ?? "").trim();

  // §3.6 — text contains a file-share URL (Drive / Dropbox / WeTransfer / etc).
  // Treat as logo received — same flow as hasMedia.
  if (t && hasLogoLink(t)) {
    const next = { ...(ctx.qState ?? {}), subFlow: "awaiting_factory_estimate" };
    await db
      .update(leads)
      .set({
        qState: next as any,
        // Per Eli 2026-07-01: keep stage at קליטה, Eli decides.
        pipelineStage: "INTAKE",
        pipelineFlag: "NEEDS_ELI",
        botPaused: true,
        botSummary: "logo link received — Eli to send final price within 24h",
        followUpCount: 0,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
    const [row] = await db
      .select({ quoteTotal: leads.quoteTotal })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`)
      .limit(1);
    await sendEliDM(
      eliLogoReceivedTemplate({
        name: ctx.name,
        phone: ctx.phone,
        quotePrice: row?.quoteTotal ?? null,
      })
    );
    await sendBridgeMessage(ctx.jid, LOGO_LINK_REPLY);
    return { action: "logo_received", detail: "logo link detected" };
  }

  // §3.3 — "אין לי לוגו" / "תכין אתה" / "תיקח מהאתר" — escalate immediately.
  if (t && /אין לי לוגו|תכין אתה|תיקח מהאתר|אין לוגו|לוגו אין/i.test(t)) {
    await sendBridgeMessage(ctx.jid, LOGO_NO_LOGO_REPLY);
    await escalateToEli(
      ctx,
      "אין ללקוח לוגו — צריך להציע אופציות בטלפון",
      undefined,
      "spec_change"
    );
    return { action: "escalated", detail: "no logo" };
  }

  // §3.4 — format question: classify text-only inbound; if it's a format
  // question, answer it without consuming a re-ask attempt.
  if (t) {
    const recent = await loadRecentMessages(ctx.sid);
    const classification = await classifyIntent({
      inboundText: t,
      recentMessages: recent,
      leadName: ctx.name,
      pipelineStage: ctx.pipelineStage,
    });
    if (classification.intent === "question_format") {
      await sendBridgeMessage(ctx.jid, REPLY_LOGO_FORMAT);
      return { action: "canned_reply", intent: classification.intent, detail: "logo_format" };
    }
  }

  // Text-only, not a format question. Re-ask up to 3 times (uses follow_up_count).
  const attempt = (ctx.followUpCount ?? 0) + 1;
  if (attempt >= 3) {
    await escalateToEli(ctx, "הלקוח לא שלח לוגו אחרי 3 בקשות", undefined);
    return { action: "escalated", detail: "no logo after 3 attempts" };
  }
  await db
    .update(leads)
    .set({
      followUpCount: attempt,
      lastFollowUpAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
  await sendBridgeMessage(ctx.jid, LOGO_REASK);
  return { action: "logo_reasked", detail: `attempt ${attempt}` };
}

async function setFinalState(
  sid: string,
  finalState: string | null,
  currentQState: any
): Promise<void> {
  const next = { ...(currentQState ?? {}), finalState };
  await db
    .update(leads)
    .set({ qState: next as any, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`);
}

/**
 * Stage 4 — customer replied to "המחיר הסופי X. מתאים?".
 * Per CUSTOMER-FLOW.md v2 §4.1-4.5:
 *   accept                  → WON + Eli DM (close deal)
 *   reject / negotiating    → ask "מה בדיוק?" (sub-state) → next turn → escalate
 *   custom_size             → escalate (§4.3 loopback deferred — Eli handles spec change)
 *   question_payment        → canned 50/50
 *   question_meeting/other  → escalate
 *   other                   → no-op (cadence)
 */
async function handleFinalStage(
  ctx: LeadCtx,
  text: string | null
): Promise<DecisionResult> {
  const t = (text ?? "").trim();
  if (!t) {
    // Same logic as INTAKE: empty text usually means media
    // without caption. Don't ghost the customer — escalate so the lead
    // surfaces in the dashboard for manual reply.
    await escalateToEli(ctx, "Customer sent media-only / empty message at CONSIDERATION", {
      kind: "generic",
      llmAnalysis:
        "הלקוח שלח הודעה בלי טקסט אחרי המחיר הסופי. ייתכן שזה הלוגו או קובץ עזר.",
      recommendation: "לבדוק את ההודעה במדיה ולענות ידנית.",
    });
    return { action: "escalated", detail: "empty text inbound (final) → escalated" };
  }

  const finalState: string | null = ctx.qState?.finalState ?? null;
  const recent = await loadRecentMessages(ctx.sid);
  const classification = await classifyIntent({
    inboundText: t,
    recentMessages: recent,
    leadName: ctx.name,
    pipelineStage: ctx.pipelineStage,
  });

  if (finalState === "awaiting_haggle_detail") {
    // §4.2.3 — customer replied to "מה בדיוק?". Ack politely; escalate.
    await sendBridgeMessage(ctx.jid, FINAL_DISCOUNT_ESCALATE_REPLY);
    await escalateToEli(
      ctx,
      "הלקוח נתן פירוט / הצעת מחיר על המחיר הסופי",
      classification.summary ?? t.slice(0, 120),
      "negotiating"
    );
    return {
      action: "escalated",
      intent: classification.intent,
      detail: "haggle reply",
    };
  }

  switch (classification.intent) {
    case "accept": {
      const cleared = {
        ...(ctx.qState ?? {}),
        finalState: null,
        decisionState: null,
      };
      await db
        .update(leads)
        .set({
          pipelineStage: "WON",
          pipelineFlag: "NEEDS_ELI",
          botPaused: true,
          botSummary: "customer accepted final price — close deal",
          qState: cleared as any,
          followUpCount: 0,
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
      await sendBridgeMessage(ctx.jid, FINAL_ACCEPT_REPLY);
      const who = ctx.name?.trim() || ctx.phone || ctx.sid;
      await sendEliDM(
        `✅ ${who} אישר את המחיר הסופי. צריך לסגור עסקה (תשלום + הזמנה).`
      );
      return { action: "won_routed", intent: classification.intent };
    }

    case "reject":
    case "negotiating": {
      await setFinalState(ctx.sid, "awaiting_haggle_detail", ctx.qState);
      await sendBridgeMessage(ctx.jid, FINAL_HAGGLE_PROMPT);
      return {
        action: "sub_state_advanced",
        intent: classification.intent,
        detail: "final → awaiting_haggle_detail",
      };
    }

    case "custom_size": {
      // §4.3 — spec change after final price. Ack with the "back to questionnaire"
      // message per BOT-COPY.md; escalate so Eli decides which fields changed
      // (true loopback is deferred — Eli re-quotes manually).
      await sendBridgeMessage(ctx.jid, FINAL_SPEC_CHANGE_REPLY);
      await escalateToEli(
        ctx,
        "הלקוח רוצה לשנות מפרט אחרי שקיבל מחיר סופי",
        classification.summary,
        "spec_change"
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: "final spec change",
      };
    }

    case "question_payment": {
      await sendBridgeMessage(ctx.jid, REPLY_PAYMENT);
      return { action: "canned_reply", intent: classification.intent, detail: "payment" };
    }
    case "question_delivery": {
      await sendBridgeMessage(ctx.jid, REPLY_DELIVERY);
      return { action: "canned_reply", intent: classification.intent, detail: "delivery" };
    }
    case "question_inclusive": {
      await sendBridgeMessage(ctx.jid, REPLY_INCLUSIVE);
      return { action: "canned_reply", intent: classification.intent, detail: "inclusive" };
    }
    case "question_format": {
      // Rare at this stage but answer politely.
      await sendBridgeMessage(ctx.jid, REPLY_LOGO_FORMAT);
      return { action: "canned_reply", intent: classification.intent, detail: "format" };
    }

    case "samples_request": {
      await sendBridgeMessage(ctx.jid, SAMPLES_REPLY);
      return { action: "samples_sent", intent: classification.intent };
    }

    case "question_meeting": {
      await sendBridgeMessage(ctx.jid, REPLY_CALL_REQUEST);
      await escalateToEli(
        ctx,
        "הלקוח ביקש לדבר בטלפון בשלב 4 (מחיר סופי)",
        classification.summary,
        "question"
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: classification.summary,
      };
    }
    case "question_other": {
      // Try unmatch agent (FAQ answer) before falling back to escalate.
      const agentResult = await runUnmatchAgent(
        ctx,
        t,
        "Stage 4 — customer asked a question the bot can't auto-answer",
        "הלקוח שאל שאלה ב-שלב 4 (מחיר סופי)",
        "question"
      );
      if (agentResult.action === "reply") {
        return {
          action: "canned_reply",
          intent: classification.intent,
          detail: "question_other → llm-answered",
        };
      }
      if (agentResult.action === "escalate") {
        return {
          action: "escalated",
          intent: classification.intent,
          detail: agentResult.llmAnalysis ?? classification.summary,
        };
      }
      // No silent path after a final quote — escalate so the lead
      // surfaces in the dashboard.
      await escalateToEli(
        ctx,
        "Customer asked a question we couldn't auto-answer (Stage 4)",
        {
          kind: "question",
          llmAnalysis: classification.summary ?? agentResult.llmAnalysis ?? null,
          recommendation: "לענות ללקוח ידנית מה-CRM.",
        }
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: "Stage 4 question_other agent noop → escalated",
      };
    }

    case "other":
    default: {
      // Hand to unmatch agent — catches compound or ambiguous replies that
      // the classifier flagged as "other".
      const agentResult = await runUnmatchAgent(
        ctx,
        t,
        "Stage 4 — intent=other, unclassified message after final price",
        "הודעה לא מסווגת מהלקוח אחרי מחיר סופי"
      );
      if (agentResult.action === "reply") {
        return {
          action: "canned_reply",
          intent: classification.intent,
          detail: "other → llm-handled",
        };
      }
      if (agentResult.action === "escalate") {
        return {
          action: "escalated",
          intent: classification.intent,
          detail: agentResult.llmAnalysis ?? "ambiguous",
        };
      }
      // Stage 4 must never go silent — escalate to dashboard.
      await escalateToEli(
        ctx,
        "Customer sent an unclassified message after final price",
        {
          kind: "generic",
          llmAnalysis: agentResult.llmAnalysis ?? `הודעה: "${t.slice(0, 120)}"`,
          recommendation: "לבדוק ולענות ידנית מה-CRM.",
        }
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: "Stage 4 other agent noop → escalated",
      };
    }
  }
}

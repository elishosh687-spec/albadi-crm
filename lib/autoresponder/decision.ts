/**
 * Post-questionnaire decision sub-flow. Aligned to docs/CUSTOMER-FLOW.md v2.
 *
 *   AWAITING_DECISION  (Stage 2 — bot asked "המחיר מתאים?")
 *     ├─ accept             → AWAITING_LOGO (bot asks for logo)
 *     ├─ samples_request    → catalog URL, stay
 *     ├─ negotiating ("יקר") → ask "יש לך הצעה מתחרה?" (sub-state)
 *     ├─ reject             → ask "יש סיבה ספציפית?" (sub-state)
 *     ├─ custom_size        → escalate (Stage 2.5 — Eli prices manually)
 *     ├─ question_delivery  → canned 25/90 days, stay
 *     ├─ question_inclusive → canned "כן הכל כלול", stay
 *     ├─ question_payment   → canned 50/50, stay
 *     ├─ question_meeting / question_other → escalate
 *     └─ other              → no-op (cadence keeps nudging)
 *
 *   Sub-states inside AWAITING_DECISION (qState.decisionState):
 *     "awaiting_reason":
 *       intent=negotiating ("יקר")  → "awaiting_competitor_offer" + COMPETITOR prompt
 *       anything else              → escalate ("סיבה אחרת")
 *     "awaiting_competitor_offer":
 *       text contains digits / negotiating → escalate (Eli decides on match)
 *       intent=reject                       → "awaiting_pause_reason" + PAUSE prompt
 *       anything else                       → escalate
 *     "awaiting_pause_reason":
 *       has any text → clear sub-state, no-op (cadence picks up 24/36/72h)
 *
 *   AWAITING_LOGO  (Stage 3)
 *     ├─ media inbound (image / file / link) → IN_PROGRESS + NEEDS_ELI + Eli DM
 *     ├─ text + intent=question_format        → canned "כל פורמט בסדר", stay
 *     └─ text (other)                          → re-ask up to 3x, then escalate
 *
 * Both sub-flows respect bot_paused (caller skips this module when paused).
 */
import { db } from "../db";
import { leads, messages as messagesTable } from "../../drizzle/schema";
import { desc, sql, eq } from "drizzle-orm";
import { sendBridgeMessage } from "../bridge/client";
import { sendEliDM } from "../notify/eli";
import { classifyIntent, type Intent } from "./intent";

const CATALOG_URL = "https://bag-quote-app.vercel.app/catalog";

// --- Bot reply copies (Hebrew) ---
const ACCEPT_REPLY =
  "מעולה! 🎉 שלח לי בבקשה את הלוגו כתמונה כאן בוואטסאפ ונמשיך הלאה.";
const SAMPLES_REPLY = `בטח! הנה הקטלוג שלנו 📚\n${CATALOG_URL}`;
const LOGO_REASK =
  "תודה! 🙏 כדי להמשיך אנחנו צריכים גם את הלוגו — אפשר לשלוח כתמונה כאן?";
const LOGO_ESCALATE_REPLY =
  "תודה! 🙏 קיבלנו את הלוגו. אחד מאיתנו יחזור אליך עם המחיר הסופי תוך 24 שעות.";

// Stage 2 sub-flow prompts
const REPLY_REASON_PROMPT =
  "יש סיבה ספציפית שנוכל לעזור איתה? נשמח לדעת מה לא מתאים.";
const REPLY_COMPETITOR_PROMPT =
  "יש לך הצעה מתחרה? נשמח לדעת את המחיר ולראות אם נוכל להתאים.";
const REPLY_PAUSE_PROMPT =
  "יש משהו ספציפי שמטריד אותך או שצריך לחשוב עליו? כתוב לנו ונסייע.";

// Stage 2 / 3 / 4 canned answers (values from CUSTOMER-FLOW.md v2 §2.4 / 3.3 / 4.4)
const REPLY_DELIVERY =
  "זמני אספקה: אקספרס ~25 יום, רגיל ~90 יום.";
const REPLY_INCLUSIVE =
  "כן, המחיר כולל הכל 🙂 (משלוח, ידיות, צבעים).";
const REPLY_PAYMENT =
  "תנאי תשלום: 50% בעת ההזמנה, 50% לפני שהסחורה יוצאת מהמפעל.";
const REPLY_LOGO_FORMAT =
  "כל פורמט בסדר 🙂 תשלח מה שיש לך — תמונה / PDF / קישור — והצוות יסדר את השאר.";

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
  return {
    sid: row.sid,
    jid: row.jid ?? sid,
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

async function escalateToEli(
  ctx: LeadCtx,
  reason: string,
  llmSummary?: string
): Promise<void> {
  // Clear any decision sub-state when escalating so re-engagement starts clean.
  const cleared = { ...(ctx.qState ?? {}), decisionState: null };
  await db
    .update(leads)
    .set({
      pipelineFlag: "NEEDS_ELI",
      botPaused: true,
      botSummary: llmSummary ?? reason,
      qState: cleared as any,
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
  const who = ctx.name?.trim() || ctx.phone || ctx.sid;
  const stage = ctx.pipelineStage || "?";
  const summaryLine = llmSummary ? `\n📝 ${llmSummary}` : "";
  await sendEliDM(`🚨 ${who} (שלב ${stage}) — ${reason}.${summaryLine} כדאי להתקשר.`);
}

function hasDigits(text: string): boolean {
  return /\d/.test(text);
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
    | "logo_reasked";
  intent?: Intent;
  detail?: string;
}

/**
 * Handle inbound for a lead currently in AWAITING_DECISION or AWAITING_LOGO.
 * Returns no_op for any other stage (caller decides what to do).
 */
export async function handleDecisionInbound(input: {
  sid: string;
  text: string | null;
  hasMedia: boolean;
}): Promise<DecisionResult> {
  const ctx = await loadLeadCtx(input.sid);
  if (!ctx) return { action: "no_op", detail: "no lead row" };

  const stage = (ctx.pipelineStage ?? "").toUpperCase();

  if (stage === "AWAITING_LOGO") {
    return handleLogoStage(ctx, input.text, input.hasMedia);
  }
  if (stage === "AWAITING_DECISION") {
    return handleDecisionStage(ctx, input.text);
  }
  return { action: "no_op", detail: `stage=${stage}` };
}

async function handleDecisionStage(
  ctx: LeadCtx,
  text: string | null
): Promise<DecisionResult> {
  const t = (text ?? "").trim();
  if (!t) return { action: "no_op", detail: "empty text" };

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
      classification.summary
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
      await escalateToEli(
        ctx,
        "הלקוח נתן מחיר/הצעה מתחרה",
        classification.summary ?? t.slice(0, 120)
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
    await escalateToEli(
      ctx,
      "הלקוח ענה תשובה לא ברורה על הצעה מתחרה",
      classification.summary
    );
    return {
      action: "escalated",
      intent: classification.intent,
      detail: "ambiguous competitor reply",
    };
  }

  if (decisionState === "awaiting_pause_reason") {
    // §2.3 — bot asked "מה מטריד?". Any text → clear sub-state, cadence picks up.
    await setDecisionState(ctx.sid, null, ctx.qState);
    return {
      action: "no_op",
      intent: classification.intent,
      detail: "pause reason captured, cadence will follow up",
    };
  }

  // --- Fresh inbound (no sub-state) ---
  switch (classification.intent) {
    case "accept": {
      const cleared = { ...(ctx.qState ?? {}), decisionState: null };
      await db
        .update(leads)
        .set({
          pipelineStage: "AWAITING_LOGO",
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
      await sendBridgeMessage(ctx.jid, REPLY_PAYMENT);
      return { action: "canned_reply", intent: classification.intent, detail: "payment" };
    }

    case "custom_size": {
      await escalateToEli(
        ctx,
        "הלקוח ביקש מידה / כמות / מפרט לא סטנדרטיים",
        classification.summary
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: classification.summary,
      };
    }
    case "question_meeting": {
      await escalateToEli(
        ctx,
        "הלקוח ביקש לדבר עם בן-אדם / פגישה",
        classification.summary
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: classification.summary,
      };
    }
    case "question_other": {
      await escalateToEli(
        ctx,
        "הלקוח שאל שאלה שהבוט לא יכול לענות עליה",
        classification.summary
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: classification.summary,
      };
    }
    case "question_format": {
      // Format question makes more sense at AWAITING_LOGO, but if it lands here,
      // answer it anyway so the customer isn't ignored.
      await sendBridgeMessage(ctx.jid, REPLY_LOGO_FORMAT);
      return { action: "canned_reply", intent: classification.intent, detail: "format" };
    }

    case "other":
    default:
      // Ambiguous — let the follow-up cron keep nudging on the spec'd cadence.
      return { action: "no_op", intent: classification.intent, detail: "ambiguous" };
  }
}

async function handleLogoStage(
  ctx: LeadCtx,
  text: string | null,
  hasMedia: boolean
): Promise<DecisionResult> {
  if (hasMedia) {
    await db
      .update(leads)
      .set({
        pipelineStage: "IN_PROGRESS",
        pipelineFlag: "NEEDS_ELI",
        botPaused: true,
        botSummary: "logo received — Eli to send final price within 24h",
        followUpCount: 0,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
    const who = ctx.name?.trim() || ctx.phone || ctx.sid;
    await sendEliDM(
      `✅ ${who} שלח לוגו. תוך 24 שעות שלח לו מחיר סופי מה-dashboard (כפתור "מחיר סופי").`
    );
    await sendBridgeMessage(ctx.jid, LOGO_ESCALATE_REPLY);
    return { action: "logo_received" };
  }

  const t = (text ?? "").trim();

  // §3.3 — format question: classify text-only inbound; if it's a format
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

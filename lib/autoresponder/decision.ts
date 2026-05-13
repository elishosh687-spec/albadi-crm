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
import {
  eliDecisionEscalationTemplate,
  eliLogoReceivedTemplate,
} from "../messaging/templates";

const CATALOG_URL = "https://bag-quote-app.vercel.app/catalog";

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
  "הכל כלול — שקיות, הדפסה, גלופה, משלוח.";
const REPLY_PAYMENT =
  "50% בעת ההזמנה, 50% לפני שהסחורה יוצאת מהמפעל. רוצים לסגור?";
const REPLY_LOGO_FORMAT = "כל פורמט בסדר. שלחו מה שיש.";
const REPLY_CALL_REQUEST = "בטח. אתקשר אליכם בקרוב.";
const REPLY_ORDER_TO_PHONE = "זה כבר בטלפון. אתקשר אליכם היום.";

// Stage 2 §2.5 — spec change in preliminary stage
const REPLY_SPEC_CHANGE_ASK =
  "אין בעיה. מה רוצים לשנות? כמות, מידה, או צבעים? תכתבו לי.";
const REPLY_SPEC_CHANGE_ACK =
  "מעולה, יש לי את הפרטים. חוזר אליכם תוך 24 שעות עם הצעה מעודכנת.";

// Stage 4 (AWAITING_FINAL) copies
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
  llmSummary?: string,
  kind: "reject" | "negotiating" | "spec_change" | "question" | "generic" = "generic"
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
  await sendEliDM(
    eliDecisionEscalationTemplate({
      name: ctx.name,
      phone: ctx.phone,
      stage: ctx.pipelineStage,
      kind,
      summary: llmSummary ?? null,
    })
  );
}

function hasDigits(text: string): boolean {
  return /\d/.test(text);
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
  if (stage === "AWAITING_FINAL") {
    return handleFinalStage(ctx, input.text);
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
    // §2.4.4B — ambiguous → escalate with a short ack so the customer isn't ignored.
    await sendBridgeMessage(ctx.jid, REPLY_COMPETITOR_AMBIGUOUS_ACK);
    await escalateToEli(
      ctx,
      "הלקוח ענה תשובה לא ברורה על הצעה מתחרה",
      classification.summary,
      "negotiating"
    );
    return {
      action: "escalated",
      intent: classification.intent,
      detail: "ambiguous competitor reply",
    };
  }

  if (decisionState === "awaiting_spec_change") {
    // §2.5.2 — customer described what to change. Ack + escalate (Eli re-quotes).
    await sendBridgeMessage(ctx.jid, REPLY_SPEC_CHANGE_ACK);
    await escalateToEli(
      ctx,
      "הלקוח ביקש לשנות את המפרט אחרי המחיר המשוער",
      classification.summary ?? t.slice(0, 120),
      "spec_change"
    );
    return {
      action: "escalated",
      intent: classification.intent,
      detail: "spec change captured",
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
      await escalateToEli(
        ctx,
        "הלקוח שאל שאלה שהבוט לא יכול לענות עליה",
        classification.summary,
        "question"
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
    await db
      .update(leads)
      .set({
        pipelineStage: "IN_PROGRESS",
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
  if (!t) return { action: "no_op", detail: "empty text" };

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
      await escalateToEli(
        ctx,
        "הלקוח שאל שאלה ב-שלב 4 (מחיר סופי)",
        classification.summary,
        "question"
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: classification.summary,
      };
    }

    case "other":
    default:
      return { action: "no_op", intent: classification.intent, detail: "ambiguous" };
  }
}

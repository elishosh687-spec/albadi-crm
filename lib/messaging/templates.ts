// Deterministic follow-up + DM copy keyed by lead stage. Hebrew, free-form
// (new bridge has no 24h limit).
//
// Voice: first person singular ("אני / אחזור / אתקשר") — this is Eli, not a
// "bot" or "team". Plural-neutral address to the customer ("אתם / לכם").
// Emojis: 0-1 per message, only when they add. See docs/BOT-COPY.md.
//
// Cadence + thresholds aligned to docs/BOT-COPY.md (which supersedes v2 spec
// where they differ — notably AWAITING_FINAL is 2h × 3, not 24/36/72h).
// See app/api/bot/followups/route.ts for the cadence rules themselves.

export type FollowupStage =
  | "MID_QUESTIONNAIRE"
  | "AWAITING_ESTIMATE"
  | "AWAITING_LOGO"
  | "AWAITING_FINAL";

const TEMPLATES: Record<FollowupStage, string[]> = {
  // Stage 1 — pipeline_stage = NEW with q_state mid-flight (not bailed, not done).
  // Cadence: 1h × 3.
  MID_QUESTIONNAIRE: [
    "30 שניות, ויש לכם הצעת מחיר. נמשיך?",
    "משהו לא ברור בשאלה? תכתבו לי, אעזור.",
    "אם נוח לכם בטלפון — תגידו, ואתקשר היום-מחר.",
  ],
  // Stage 2 — bot waiting on customer response to estimated quote.
  // Cadence: 2h / 12h / 23h.
  AWAITING_ESTIMATE: [
    "היי, חוזר אליכם. רציתי לשמוע מה דעתכם על ההצעה ששלחתי.",
    "אם נוח לכם בטלפון — תגידו, אתקשר.",
    "ניסיון אחרון. רוצים שאתקשר, או שנעזוב לעת עתה?",
  ],
  // Stage 3 — bot waiting on logo file.
  // Cadence: 2h / 12h / 23h.
  AWAITING_LOGO: [
    "היי, מחכה ללוגו שלכם כדי לשלוח את המחיר הסופי. אפשר לשלוח עכשיו?",
    "משהו מעכב את הלוגו? תכתבו לי.",
    "ניסיון אחרון. רוצים שאתקשר?",
  ],
  // Stage 4 — bot waiting on customer response to final price.
  // Cadence: 2h / 12h / 23h (same as Stages 2/3). Final price is hot;
  // we lead with a 2h nudge while the price is still fresh.
  AWAITING_FINAL: [
    "היי, חוזר אליכם לגבי המחיר הסופי. הספקתם לחשוב על ההצעה?",
    "אם יש משהו שצריך להבהיר — תכתבו לי. אם לא — אעביר את זה לסיים בטלפון.",
    "אם לא מתאים עכשיו — אין בעיה, תחזרו אליי כשתרצו. אחרת אתקשר היום-מחר.",
  ],
};

/**
 * Pick the message body for a given attempt number (1-based). `attempt`
 * comes from `leads.follow_up_count` BEFORE the send (so first send uses
 * attempt=1 when count was 0).
 */
export function followupTemplate(
  stage: FollowupStage,
  attempt: number
): string {
  const list = TEMPLATES[stage];
  const idx = Math.min(Math.max(attempt - 1, 0), list.length - 1);
  return list[idx];
}

/**
 * Eli-only daily reminder while a lead sits in WAITING_FACTORY.
 * Escalates wording after 3+ days waiting — past 3 days the chance of
 * losing the lead grows.
 */
export function eliFactoryReminderTemplate(input: {
  name: string | null | undefined;
  phone: string | null | undefined;
  daysWaiting: number;
}): string {
  const who = input.name?.trim() || input.phone || "ליד";
  if (input.daysWaiting >= 3) {
    return `🔥 ${who} מחכה ${input.daysWaiting} ימים — הסיכוי שיברח עולה. תתמחר היום.`;
  }
  return `⏰ ${who} מחכה ${input.daysWaiting} ימים לציטוט.`;
}

/**
 * Eli WA DM when a lead crosses the 3-strike escalation threshold from
 * the follow-up cron or webhook stop-word handler.
 */
export function eliEscalationTemplate(input: {
  name: string | null | undefined;
  phone: string | null | undefined;
  stage: string | null | undefined;
  reason: "no_reply" | "stop_word" | "bail";
}): string {
  const who = input.name?.trim() || input.phone || "ליד";
  const stage = (input.stage || "NEW").trim();
  switch (input.reason) {
    case "no_reply":
      return (
        `⏰ ${who} (שלב ${stage}) — קר אחרי 3 פולואפים.\n` +
        `📞 שיחה אחרונה לפני שמוחקים.`
      );
    case "stop_word":
      return (
        `🛑 ${who} (שלב ${stage}) — ביקש להפסיק / לא מעוניין.\n` +
        `הבוט עוצר אוטומטית.`
      );
    case "bail":
      return (
        `⚠️ ${who} — לא הצליח בשאלון האוטומטי (שלב ${stage}).\n` +
        `📞 שיחה ידנית — אולי לקוח רציני שזקוק לעזרה.`
      );
  }
}

/**
 * Eli WA DM when the decision sub-flow escalates a lead. Picks the right
 * header per reason so the message is scannable.
 *
 * `llmAnalysis` + `recommendation` are populated when an LLM (unmatch-agent or
 * spec-extractor) was in the path and decided to escalate. When present, they
 * give Eli the "why" and the "what to do next" without him having to scan the
 * thread. When absent, the DM falls back to the legacy `summary` line.
 */
export function eliDecisionEscalationTemplate(input: {
  name: string | null | undefined;
  phone: string | null | undefined;
  stage: string | null | undefined;
  /** kind: rejection vs negotiation vs generic question */
  kind: "reject" | "negotiating" | "spec_change" | "question" | "generic";
  summary?: string | null;
  /** LLM's reading of what the customer wants (Hebrew). */
  llmAnalysis?: string | null;
  /** LLM's suggested next move for Eli (Hebrew). */
  recommendation?: string | null;
}): string {
  const who = input.name?.trim() || input.phone || "ליד";
  const stage = (input.stage || "?").trim();

  // When LLM was in the path, prefer the richer analysis/recommendation block
  // over the bare `summary` line. Keep `summary` as a fallback for legacy
  // callers (questionnaire bails, hand-coded escalations).
  const analysis = input.llmAnalysis?.trim();
  const recommendation = input.recommendation?.trim();
  const hasLLM = Boolean(analysis || recommendation);

  const detailLines: string[] = [];
  if (hasLLM) {
    if (analysis) detailLines.push(`🤖 ניתוח: ${analysis}`);
    if (recommendation) detailLines.push(`💡 המלצה: ${recommendation}`);
  } else if (input.summary?.trim()) {
    detailLines.push(`📝 ${input.summary.trim()}`);
  }
  const detail = detailLines.length ? "\n" + detailLines.join("\n") : "";

  switch (input.kind) {
    case "reject":
      return `🚨 ${who} (שלב ${stage}) — דחה את ההצעה.${detail}\n📞 כדאי להתקשר תוך 4 שעות.`;
    case "negotiating":
      return `💰 ${who} (שלב ${stage}) — מתמקח על המחיר.${detail}\n📞 כדאי להתקשר היום`;
    case "spec_change":
      return `🔧 ${who} (שלב ${stage}) — רוצה לשנות מפרט.${detail}\n📞 צריך להתאים מחיר.`;
    case "question":
      return `❓ ${who} (שלב ${stage}) — שאל שאלה שדורשת אותך.${detail}\n📞 התקשר אליו.`;
    case "generic":
    default:
      return `🚨 ${who} (שלב ${stage}) — צריך התערבות.${detail}\n📞 כדאי להתקשר.`;
  }
}

/**
 * Eli WA DM when a logo file lands. Includes the preliminary quote so Eli
 * has the context to send a final price quickly.
 */
export function eliLogoReceivedTemplate(input: {
  name: string | null | undefined;
  phone: string | null | undefined;
  quotePrice: string | null | undefined;
}): string {
  const who = input.name?.trim() || input.phone || "ליד";
  const price = input.quotePrice?.trim();
  const priceLine = price ? `\n💰 מחיר משוער: ${price}` : "";
  return `✅ ${who} שלח לוגו.${priceLine}\n📞 צריך לשלוח מחיר סופי תוך 24 שעות.`;
}

/**
 * Auto-reply sent to the customer when their inbound matches a stop-word.
 * Sent once; bot then goes silent (bot_paused = true).
 */
export const STOP_WORD_REPLY =
  "הבנתי, לא אטריד יותר. אם תרצו בעתיד — תכתבו לי ואני כאן.";

// Stop-word detection — substring match on lowercased trimmed text.
// Order: most specific first to keep matching cheap.
const STOP_PATTERNS_LOWER: string[] = [
  "תפסיק",
  "תפסיקו",
  "לא מעוניין",
  "לא מענין",
  "הסר אותי",
  "אל תשלחו",
  "אל תשלח",
  "stop",
  "remove me",
  "unsubscribe",
];

export function isStopWord(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return STOP_PATTERNS_LOWER.some((p) => t.includes(p));
}

// Deterministic follow-up + DM copy keyed by lead stage. Hebrew, free-form
// (new bridge has no 24h limit).
//
// Voice: first person singular ("אני / אחזור / אתקשר") — this is Eli, not a
// "bot" or "team". Plural-neutral address to the customer ("אתם / לכם").
// Emojis: 0-1 per message, only when they add. See docs/BOT-COPY.md.
//
// Cadence + thresholds aligned to docs/BOT-COPY.md. See
// app/api/bot/followups/route.ts for the cadence rules themselves.
//
// Labels here are autoresponder-template keys (not pipeline_stage values).
// AWAITING_LOGO is the logo-collection follow-up template used while
// pipeline_stage=FACTORY_CHECK + qState.subFlow=awaiting_logo.

export type FollowupStage =
  | "MID_QUESTIONNAIRE"
  | "INITIAL_QUOTE_SENT"
  | "AWAITING_LOGO"
  | "FINAL_QUOTE_SENT"
  // Re-engagement loop for leads at NO_RESPONSE_REENGAGE. Body is built per
  // send by `lib/autoresponder/re-engagement.ts` via LLM — the entries below
  // are only used as a fallback if the LLM call returns nothing.
  | "RE_ENGAGEMENT";

const TEMPLATES: Record<FollowupStage, string[]> = {
  // pre-quote — questionnaire mid-flight (not bailed, not done).
  // Cadence: 1h × 3.
  MID_QUESTIONNAIRE: [
    "30 שניות, ויש לכם הצעת מחיר. נמשיך?",
    "משהו לא ברור בשאלה? תכתבו לי, אעזור.",
    "אם נוח לכם בטלפון — תגידו, ואתקשר היום-מחר.",
  ],
  // INITIAL_QUOTE_SENT — bot waiting on customer response to estimated quote.
  // Cadence: 2h / 12h / 23h.
  INITIAL_QUOTE_SENT: [
    "היי, חוזר אליכם. רציתי לשמוע מה דעתכם על ההצעה ששלחתי.",
    "אם נוח לכם בטלפון — תגידו, אתקשר.",
    "ניסיון אחרון. רוצים שאתקשר, או שנעזוב לעת עתה?",
  ],
  // FACTORY_CHECK (subFlow=awaiting_logo) — bot waiting on logo file.
  // Cadence: 2h / 12h / 23h.
  AWAITING_LOGO: [
    "היי, מחכה ללוגו שלכם כדי לשלוח את המחיר הסופי. אפשר לשלוח עכשיו?",
    "משהו מעכב את הלוגו? תכתבו לי.",
    "ניסיון אחרון. רוצים שאתקשר?",
  ],
  // FINAL_QUOTE_SENT — bot waiting on customer response to final price.
  // Cadence: 2h / 12h / 23h. Final price is hot; we lead with a 2h nudge
  // while the price is still fresh.
  FINAL_QUOTE_SENT: [
    "היי, חוזר אליכם לגבי המחיר הסופי. הספקתם לחשוב על ההצעה?",
    "אם יש משהו שצריך להבהיר — תכתבו לי. אם לא — אעביר את זה לסיים בטלפון.",
    "אם לא מתאים עכשיו — אין בעיה, תחזרו אליי כשתרצו. אחרת אתקשר היום-מחר.",
  ],
  // Fallback only — re-engagement.ts.buildReEngagementMessage normally
  // produces a personalized body. These are used if the LLM call errors.
  RE_ENGAGEMENT: [
    "היי 👋 רק רציתי להזכיר שאנחנו כאן אם בא לך להתקדם עם ההצעה לשקיות הממותגות. תכתוב/י לי בכל זמן.",
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
 * Eli-only daily reminder while a lead sits in FACTORY_CHECK (subFlow=awaiting_factory_estimate).
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
  "לא רלוונטי",
  "לא רלוונטית",
  "לא מעניין",
  "לא מעניין אותי",
  "לא מענין אותי",
  "הסר",
  "הסירו",
  "להסיר",
  "הסר אותי",
  "תוריד אותי",
  "תורידו אותי",
  "אל תשלחו",
  "אל תשלח",
  "די לי",
  "להפסיק",
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

// Facebook Click-to-WhatsApp auto-fill detection.
//
// When a customer clicks the "WhatsApp" button on a FB/IG ad, Meta pre-fills
// the chat input with a fixed prompt text. If the customer hits send without
// editing, that text becomes our first inbound — but it's not a real customer
// message, it's a system-triggered "I tapped your ad" event. The bot should
// stay silent and wait for the customer's actual first message.
//
// We match each known prompt as a normalized-substring rule (lowercase, NFKC,
// punctuation/emoji stripped) so trivial variations (trailing punctuation, an
// extra emoji) still skip. To add a new ad campaign's prompt, append it here
// in lowercased form — the normalizer handles the rest.
const FB_CTWA_AUTOFILLS_NORMALIZED: string[] = [
  // Hebrew variants — Meta uses both "שלום" and "היי" depending on campaign.
  "שלום אשמח לקבל הצעת מחיר בדקה",
  "היי אשמח לקבל הצעת מחיר בדקה",
  // English variants (kept in case a campaign runs in EN).
  "hi! i'd like a price quote in a minute",
  "hi i would like a price quote in a minute",
];

function normalizeForCtwaMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    // Strip everything that isn't a Hebrew letter (U+0590–U+05FF), Latin
    // letter, or digit. Removes emoji, punctuation, ZWJ/RTL marks, etc.
    .replace(/[^֐-׿a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isFacebookCtwaAutoFill(
  text: string | null | undefined
): boolean {
  if (!text) return false;
  const t = normalizeForCtwaMatch(text);
  if (!t) return false;
  return FB_CTWA_AUTOFILLS_NORMALIZED.some((p) =>
    t.includes(normalizeForCtwaMatch(p))
  );
}

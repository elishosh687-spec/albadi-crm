// Deterministic follow-up copy keyed by lead stage. Hebrew, free-form
// (new bridge has no 24h limit).
//
// Cadence + thresholds are aligned to docs/CUSTOMER-FLOW.md v2:
//   - Stage 1 (mid-questionnaire, NEW): 1h × 3.
//   - Stages 2 / 3 / 4: 24h → 36h → 72h.
// See app/api/bot/followups/route.ts for the cadence rules.

export type FollowupStage =
  | "MID_QUESTIONNAIRE"
  | "AWAITING_DECISION"
  | "AWAITING_LOGO"
  | "AWAITING_FINAL";

const TEMPLATES: Record<FollowupStage, string[]> = {
  // pipeline_stage = NEW with q_state mid-flight (not bailed, not done).
  MID_QUESTIONNAIRE: [
    "היי 👋 ראיתי שהתחלנו את השאלון אבל לא סיימנו. רוצה להמשיך? פשוט תכתוב את התשובה לשאלה האחרונה.",
    "תזכורת קטנה — נשארנו באמצע השאלון להצעת מחיר. תוך דקה אנחנו מסיימים 😊",
    "מנסה לתפוס אותך שוב — רוצה שנמשיך מאיפה שעצרנו? כתוב לי תשובה ונסיים.",
  ],
  // Stage 2 — bot waiting on customer response to estimated quote.
  AWAITING_DECISION: [
    "היי, רציתי לשמוע מה דעתך על ההצעה ששלחנו 🙏",
    "מה דעתך על המחיר? משהו לא ברור או שתרצה לשנות?",
    "תזכורת אחרונה — תרצה שנמשיך הלאה עם ההצעה, או שיש משהו שצריך להתאים?",
  ],
  // Stage 3 — bot waiting on logo file.
  AWAITING_LOGO: [
    "היי 👋 מחכים לקבל את הלוגו כדי להמשיך לציטוט סופי.",
    "תזכורת קטנה — תשלח לוגו (תמונה / PDF / קישור) ונמשיך הלאה.",
    "ניסיון אחרון לתפוס אותך — תשלח לוגו ונסגור את ההצעה.",
  ],
  // Stage 4 — bot waiting on customer response to final price.
  AWAITING_FINAL: [
    "היי, רציתי לשמוע מה דעתך על המחיר הסופי 🙏",
    "תזכורת קטנה — תרצה שנתקדם לסגירה, או שיש משהו לא ברור?",
    "ניסיון אחרון — נשמח לדעת מה דעתך על המחיר הסופי.",
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

/** Eli-only daily reminder while a lead sits in WAITING_FACTORY. */
export function eliFactoryReminderTemplate(input: {
  name: string | null | undefined;
  phone: string | null | undefined;
  daysWaiting: number;
}): string {
  const who = input.name?.trim() || input.phone || "ליד";
  return `⏰ ${who} מחכה ${input.daysWaiting} ימים לציטוט מהמפעל. צריך לעדכן את הציטוט בלוח המחוונים.`;
}

/** Eli WA DM when a lead crosses the 3-strike escalation threshold. */
export function eliEscalationTemplate(input: {
  name: string | null | undefined;
  phone: string | null | undefined;
  stage: string | null | undefined;
  reason: "no_reply" | "stop_word" | "bail";
}): string {
  const who = input.name?.trim() || input.phone || "ליד";
  const stage = (input.stage || "NEW").trim();
  const reasonText: Record<typeof input.reason, string> = {
    no_reply: "קר אחרי 3 פולואפים",
    stop_word: "ביקש להפסיק / לא מעוניין",
    bail: "נכשל בשאלון האוטומטי",
  };
  return `🚨 ${who} (שלב ${stage}) — ${reasonText[input.reason]}. כדאי להתקשר.`;
}

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

// Deterministic follow-up copy keyed by lead stage. Hebrew, free-form
// (no business-template approval needed — new bridge has no 24h limit).
//
// LLM per-customer polish is deferred; these stay as plain string interpolation.

export type FollowupStage =
  | "MID_QUESTIONNAIRE"
  | "QUOTED"
  | "NEGOTIATING_OR_CALL";

const TEMPLATES: Record<FollowupStage, string[]> = {
  // pipeline_stage = NEW with q_state mid-flight (not bailed, not done).
  MID_QUESTIONNAIRE: [
    "היי 👋 ראיתי שהתחלנו את השאלון אבל לא סיימנו. רוצה להמשיך? פשוט תכתוב את התשובה לשאלה האחרונה.",
    "תזכורת קטנה — נשארנו באמצע השאלון להצעת מחיר. תוך דקה אנחנו מסיימים 😊",
    "מנסה לתפוס אותך שוב — רוצה שנמשיך מאיפה שעצרנו? כתוב לי תשובה ונסיים.",
  ],
  QUOTED: [
    "היי, רציתי לשמוע מה דעתך על ההצעה ששלחנו 🙏",
    "מה דעתך על המחיר? משהו לא ברור או שתרצה לשנות?",
    "תזכורת אחרונה — תרצה שנמשיך הלאה עם ההצעה, או שיש משהו שצריך להתאים?",
  ],
  NEGOTIATING_OR_CALL: [
    "היי 🙂 רוצה שנקבע שיחה קצרה לסגור את הפרטים?",
    "מנסה לסגור איתך — מה השעה שנוחה לך לשיחה היום/מחר?",
    "רוצה שאחזיר אליך טלפון? תכתוב לי שעה שמתאימה.",
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

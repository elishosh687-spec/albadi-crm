/**
 * The setter writes the follow-up nudges.
 *
 * Until now every silent lead got one of 13 fixed sentences, picked by stage
 * and attempt number — the same "היי, חוזר אליכם" to a customer who argued
 * about price and to one who never answered a single question. They are also
 * the most-sent messages in the system (every lead can receive three), and
 * they were the only ones the sales brain never touched.
 *
 * The division of labour does not change: **code decides WHEN to speak and
 * WHETHER a lead is due** — cadence, attempt caps, quiet hours, Sabbath — and
 * the setter only supplies the WORDS, with the whole conversation in view.
 *
 * The canned text stays as the floor. Any failure, any timeout, any message
 * the validator rejects, and the caller falls back to it, so a bad LLM day
 * degrades to today's behaviour instead of silence.
 */
import { runSetter } from "./index";
import { getBotSettings } from "../bot-settings/store";

/** Hebrew hints so the generator knows what this particular nudge is FOR. */
const STAGE_INTENT: Record<string, string> = {
  MID_QUESTIONNAIRE:
    "הלקוח התחיל למלא את השאלון ונעצר באמצע. המטרה: להחזיר אותו להשלים את הפרטים, בלי ללחוץ.",
  INTAKE:
    "הלקוח קיבל הצעת מחיר ולא הגיב. המטרה: להבין איפה הוא עומד, ואם אפשר — לקבוע שיחה.",
  AWAITING_LOGO:
    "הלקוח אישר את ההצעה אבל לא שלח לוגו. המטרה: להוציא ממנו את הלוגו כדי להתקדם.",
  CONSIDERATION:
    "הלקוח מחזיק את המחיר הסופי ושוקל. המטרה: להזיז את ההחלטה קדימה, עדיף לשיחה.",
  RE_ENGAGEMENT:
    "ליד קר שלא הגיב הרבה זמן. המטרה: לפתוח מחדש בעדינות, בלי להתנצל ובלי ללחוץ.",
};

export interface FollowupComposition {
  text: string;
  /** For the decision log / debugging — which run produced this. */
  decisionId?: number;
}

/**
 * Ask the setter for this lead's next nudge. Returns null whenever the caller
 * should use the canned template instead — the caller must always have one.
 */
export async function composeSetterFollowup(input: {
  sid: string;
  stage: string;
  attempt: number;
}): Promise<FollowupComposition | null> {
  const S = await getBotSettings();
  if (!S.setterWritesFollowups) return null;

  try {
    const run = await runSetter(input.sid, `followup:${input.stage}:${input.attempt}`, {
      mode: "live",
      // The cadence already decided this lead is due, so the setter's own
      // "stay quiet" verdict must not veto the send — it would leave the lead
      // with no nudge at all. It still shapes WHAT gets said.
      force: true,
      situation: STAGE_INTENT[input.stage],
      attempt: input.attempt,
    });

    const text = run.message?.text?.trim();
    if (!run.ok || !text) return null;
    // The validator's verdict is authoritative; a rejected message is exactly
    // the case the canned fallback exists for.
    if (run.message && run.message.validation?.ok === false) return null;
    return { text, decisionId: run.decisionId };
  } catch (e) {
    console.warn("[setter.followup] compose failed, falling back to template", e);
    return null;
  }
}

/**
 * Let the sales brain phrase a reply that the CODE is executing.
 *
 * These are the moments where the sentence and a state change were written as
 * one thing: "מתאים לי" advances the lead and asks for the logo, a received
 * logo mutes the bot and hands Eli the pricing, a spec change triggers a
 * re-quote. Because they were fused, they stayed hardcoded — the most decisive
 * moments in the funnel, and every customer heard the identical sentence.
 *
 * They separate cleanly. The code still performs the transition; only the
 * wording moves here.
 *
 * THE OPERATIVE ASK IS NOT NEGOTIABLE. If the canned line asks for a logo, the
 * rewrite must still ask for a logo — otherwise the flow stalls waiting for a
 * file the customer was never asked to send. `mustMention` enforces exactly
 * that, and anything that fails it falls back to the original sentence. Losing
 * the personalisation is a bad day; losing the request is a broken funnel.
 */
import { runSetter } from "./index";
import { getBotSettings } from "../bot-settings/store";

export interface PhraseInput {
  sid: string;
  /** What just happened and what the customer must do next, in Hebrew. */
  situation: string;
  /** The canned sentence. Always the floor — returned on any failure. */
  fallback: string;
  /** Words that MUST survive the rewrite, or the fallback is used instead. */
  mustMention?: string[];
  /** For the decision log. */
  trigger: string;
}

export async function phraseStateReply(input: PhraseInput): Promise<string> {
  let S;
  try {
    S = await getBotSettings();
  } catch {
    return input.fallback;
  }
  if (!S.setterPhrasesStateReplies || !S.setterLiveEnabled) return input.fallback;

  try {
    const run = await runSetter(input.sid, `phrase:${input.trigger}`, {
      mode: "live",
      // The code has already decided this turn speaks; the setter only chooses
      // the words, so its own "stay quiet" verdict must not produce silence.
      force: true,
      situation:
        `${input.situation}\n\n` +
        `הניסוח הקבוע שאתה מחליף: "${input.fallback}"\n` +
        "שמור על אותה משמעות ועל אותה בקשה מהלקוח. אל תוסיף מחירים, תאריכים או הבטחות שלא מופיעים שם.",
    });

    const text = run.message?.text?.trim();
    if (!run.ok || !text) return input.fallback;
    if (run.message?.validation?.ok === false) return input.fallback;

    for (const word of input.mustMention ?? []) {
      if (!text.includes(word)) {
        console.warn(
          `[setter.phrase] dropped rewrite for ${input.trigger} — lost "${word}"`
        );
        return input.fallback;
      }
    }
    return text;
  } catch (e) {
    console.warn(`[setter.phrase] failed for ${input.trigger}, using fallback`, e);
    return input.fallback;
  }
}

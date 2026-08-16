/**
 * Why the bot went quiet on a lead — and whether it may wake up on its own.
 *
 * Until now `bot_paused` was a bare boolean with no memory of who set it or
 * why, and nothing ever cleared it. Measured 2026-08-16: **81 of 117** leads
 * with recent inbound traffic were paused forever, so the questionnaire, the
 * follow-ups and the sales brain were all silent on the overwhelming majority
 * of live conversations. The single biggest cause is the pause that fires the
 * moment a human answers in the thread — a pause that was always meant to be
 * "I've got this one right now", never "never speak to this customer again".
 *
 * The fix is not a global timer. A pause means different things depending on
 * who asked for it, and two of them are promises to the customer:
 *   • `opt_out`        — they asked us to stop. Waking up would be a breach.
 *   • `human_handoff`  — they asked for a person. Same.
 *   • `manual_toggle`  — Eli flipped the switch himself. Respect it.
 * So only the reasons that mean "a human is driving this one for now" expire.
 */

export type BotPauseReason =
  /** A human replied in the thread — widget, or typing straight into WhatsApp. */
  | "human_reply"
  /** The bot handed the money moment to Eli and stepped back. */
  | "escalation"
  /** Customer sent their logo; Eli owes them a final price. */
  | "logo_received"
  /** Customer answered a re-engagement message. */
  | "reengagement_reply"
  /** Customer asked us to stop contacting them. */
  | "opt_out"
  /** Customer asked to speak to a person instead of the bot. */
  | "human_handoff"
  /** Customer accepted the final price — the deal is closing by hand. */
  | "deal_won"
  /** Follow-ups ran out without a reply; don't restart the nagging. */
  | "no_reply"
  /** Eli flipped the toggle deliberately. */
  | "manual_toggle"
  /** Paused before this column existed — cause unknown. */
  | "legacy";

/**
 * The reasons that expire. Everything absent from this set stays paused until
 * a human says otherwise — silence is the safe default when we can't be sure
 * the customer wants to hear from a bot again.
 */
export const AUTO_RESUMABLE_REASONS: ReadonlySet<BotPauseReason> = new Set([
  "human_reply",
  "escalation",
  "logo_received",
  "reengagement_reply",
]);

export function isAutoResumable(reason: string | null | undefined): boolean {
  return !!reason && AUTO_RESUMABLE_REASONS.has(reason as BotPauseReason);
}

/** Hebrew labels for the CRM screens. */
export const PAUSE_REASON_LABELS: Record<BotPauseReason, string> = {
  human_reply: "אדם ענה בשיחה",
  escalation: "הועבר לטיפולך",
  logo_received: "התקבל לוגו",
  reengagement_reply: "הגיב להודעת החייאה",
  opt_out: "הלקוח ביקש להסיר",
  human_handoff: "הלקוח ביקש בן אדם",
  deal_won: "העסקה נסגרה",
  no_reply: "לא ענה אחרי מעקבים",
  manual_toggle: "כובה ידנית",
  legacy: "לא ידוע (לפני המעקב)",
};

/**
 * The fields every pause site writes. Spread this instead of setting
 * `botPaused: true` by hand, so a pause can never again land without its
 * reason — that missing reason is what made the 81 leads un-diagnosable.
 */
export function pauseFields(reason: BotPauseReason) {
  return {
    botPaused: true,
    botPausedAt: new Date(),
    botPauseReason: reason,
    updatedAt: new Date(),
  } as const;
}

/** Clearing a pause must also clear its bookkeeping, or the next sweep re-reads stale state. */
export function resumeFields() {
  return {
    botPaused: false,
    botPausedAt: null,
    botPauseReason: null,
    updatedAt: new Date(),
  } as const;
}

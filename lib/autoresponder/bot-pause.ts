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

import type { SQL } from "drizzle-orm";

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

/**
 * The pauses GHL is NOT allowed to lift.
 *
 * `bot_paused` is a GHL-owned shared field, so any resync pushes its value back
 * into the DB — and until 2026-08-18 that silently un-paused leads the bot had
 * muted deliberately, leaving `bot_pause_reason` behind as a stale ghost.
 * Measured symptom: an escalated lead came back to life and re-escalated, so
 * Eli got the same "cold after 3 follow-ups" alert twice within the hour.
 *
 * These two reasons are promises made to the customer, not bookkeeping — they
 * asked us to stop, or asked for a person. A checkbox in a CRM that nobody
 * deliberately unticked must not override that. Everything else (no_reply,
 * escalation, deal_won, …) stays GHL's to change: those are our own workflow
 * states, and Eli overruling them from the contact card is the point.
 */
export const GHL_IRREVOCABLE_REASONS: ReadonlySet<BotPauseReason> = new Set([
  "opt_out",
  "human_handoff",
]);

/**
 * Translate a pause/unpause that ORIGINATED IN GHL into the fields to write.
 *
 * Returns `null` when the change must be refused — the caller should leave the
 * lead alone and log it. Un-pausing also clears the reason columns, which the
 * GHL write sites never did: that omission is what left `bot_paused=false`
 * alongside a live `bot_pause_reason` and made the state un-diagnosable.
 */
export function ghlPauseChange(
  paused: boolean,
  currentReason: string | null | undefined
): ReturnType<typeof pauseFields> | ReturnType<typeof resumeFields> | null {
  if (paused) return pauseFields("manual_toggle");
  if (currentReason && GHL_IRREVOCABLE_REASONS.has(currentReason as BotPauseReason)) {
    return null;
  }
  return resumeFields();
}

/**
 * Apply a GHL-originated pause change to whichever lead `whereClause` matches.
 *
 * Reads the current reason first so an irrevocable pause can be refused rather
 * than overwritten. One extra query on a webhook, in exchange for never again
 * messaging someone who asked us to stop because a CRM checkbox said "Bot".
 */
export async function applyGhlPause(
  whereClause: SQL<unknown>,
  paused: boolean
): Promise<"updated" | "refused" | "not_found"> {
  const { db } = await import("@/lib/db");
  const { leads } = await import("@/drizzle/schema");
  const [row] = await db
    .select({ reason: leads.botPauseReason })
    .from(leads)
    .where(whereClause)
    .limit(1);
  if (!row) return "not_found";

  const fields = ghlPauseChange(paused, row.reason);
  if (!fields) return "refused";

  await db.update(leads).set(fields).where(whereClause);
  return "updated";
}

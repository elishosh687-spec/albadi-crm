/**
 * The one-time printing plate / mold fee: ¥1,000 per logo colour.
 *
 * Each colour needs its own printing plate at the factory, and the fee is
 * charged once per order regardless of quantity. It is deliberately a fixed
 * house number rather than a factory pass-through — Eli treats the padding as
 * negotiating room he can give back later (see the "Calc colors + breakdown"
 * note in CLAUDE.md), so DON'T "fix" it against a factory invoice.
 *
 * Client-safe on purpose: the calculator screen (a client component) and the
 * bot (server) must quote the same number, and the value existed as three
 * separate literals before this module — the calculator's, the sales form's,
 * and none at all in the bot, which is how the bot's auto-quote came to omit
 * the fee entirely while every manual quote charged it.
 */
export const MOLD_CNY_PER_COLOR = 1000;

/** ¥ for a whole order — the fee is per colour, once, not per unit. */
export function moldsCostCnyFor(logoColors: number): number {
  const colors = Math.max(1, Math.round(Number(logoColors) || 1));
  return MOLD_CNY_PER_COLOR * colors;
}

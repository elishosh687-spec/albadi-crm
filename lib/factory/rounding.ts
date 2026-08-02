/**
 * THE rounding rule for anything a customer is charged.
 *
 * Eli 2026-08-02: "קודם כל תמיד לעגל כלפי מעלה אני רוצה, וזה יופיע תמיד גם ללקוח.
 * כרגע אני רואה שיש הבדלים."
 *
 * Two rules, and every customer-facing surface obeys both:
 *  1. The per-bag price is rounded UP to the agora — never down. A price that
 *     rounds down (₪1.22342 → ₪1.22) quietly sells 5,000 bags for ₪17 under the
 *     computed price; rounding up can only ever be in Albadi's favour.
 *  2. The order total is DERIVED from that rounded price (unit × qty + one-time
 *     molds), never computed from the unrounded one. That is what makes
 *     "מחיר × כמות" reconcile on the customer's own calculator.
 *
 * Internal cost/profit figures keep full precision — this is about what is
 * quoted and billed, not about how we account for it.
 *
 * Client-safe: pure arithmetic.
 */

/** Round UP to the agora (2 decimals). The customer price rule. */
export function ceilAgorot(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Nudge by an epsilon before ceiling so values already ON the agora (or a
  // float artifact below it, e.g. 0.69 stored as 0.6899999999999999) don't get
  // pushed a whole agora up.
  return Math.ceil(n * 100 - 1e-9) / 100;
}

/** Round to the nearest agora — for money that is not a per-unit customer price
 *  (totals already derived, one-time fees, internal figures). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

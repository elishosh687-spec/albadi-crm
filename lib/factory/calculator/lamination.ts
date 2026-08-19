/**
 * The 3-colour lamination rule, in one place.
 *
 * Business rule (Eli, confirmed 2026-08-19): three or more print colours
 * REQUIRE lamination — the factory cannot hold registration without it. So a
 * quote for 3 colours is a laminated quote whether or not anyone ticked the box.
 *
 * It used to be re-implemented at seven call sites. The three calculator
 * screens forced the checkbox before pricing, so they were right; the bot did
 * not, and `buildQuoteMessage` applied the rule ONLY to the display string:
 *
 *     const laminationText = hasLamination || logoColors >= 3 ? "עם" : "ללא";
 *
 * The result was a quote that said "עם למינציה" and was priced without it.
 * Roberto Baghdadi, 18/08: ₪1.85/unit instead of ₪2.57 — ₪5,550 against a real
 * ₪7,710, and the customer holds the cheaper number in writing.
 *
 * Pure and dependency-free so client components can import it (see the
 * client-bundle rule in CLAUDE.md).
 */

/** Colour count at and above which lamination stops being optional. */
export const LAMINATION_FORCED_FROM_COLORS = 3;

export function requiresLamination(logoColors: number): boolean {
  return (Number(logoColors) || 0) >= LAMINATION_FORCED_FROM_COLORS;
}

/**
 * The lamination value to PRICE and to DISPLAY. Resolve once, before the
 * engine runs, and pass the result everywhere — never re-derive it downstream,
 * which is exactly how the price and the text came apart.
 */
export function resolveLamination(chosen: boolean, logoColors: number): boolean {
  return chosen || requiresLamination(logoColors);
}

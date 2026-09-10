/**
 * When lamination is suggested — in one place.
 *
 * History. Until 2026-09-10 this was a hard rule: three or more print colours
 * REQUIRED lamination (Eli, 2026-08-19 — "the factory cannot hold registration
 * without it"), and `resolveLamination` was an OR that could never return false
 * at 3+. On 2026-09-10 Eli changed it: from FOUR colours lamination is the
 * DEFAULT, and a person can still turn it off.
 *
 * Why it is still one module. The rule used to be re-implemented at seven call
 * sites, and `buildQuoteMessage` applied it to the display string only — a
 * quote that said "עם למינציה" and was priced without it (Roberto Baghdadi,
 * 18/08: ₪5,550 against a real ₪7,710, and the customer holds the cheaper
 * number in writing). Resolve once, price and print the SAME value, never
 * re-derive it downstream. With a default instead of a rule that matters more,
 * not less: any display path that still "forces" lamination would now
 * contradict a price that honestly leaves it out.
 *
 * ⚠️ The supplier's own price sheet stops at three colours in BOTH finishes, so
 * every 4+ colour price is our extrapolation — see ./color-addon.ts.
 *
 * Pure and dependency-free so client components can import it (see the
 * client-bundle rule in CLAUDE.md).
 */

/** Colour count from which lamination is PRE-SELECTED. A default, not a lock. */
export const LAMINATION_DEFAULT_FROM_COLORS = 4;

export function suggestsLamination(logoColors: number): boolean {
  return (Number(logoColors) || 0) >= LAMINATION_DEFAULT_FROM_COLORS;
}

/**
 * The lamination value to PRICE and to DISPLAY.
 *
 * `chosen` is three-state on purpose: `true` / `false` is a person's decision
 * and always wins; `null` / `undefined` means nobody decided, and only then
 * does the colour count supply the default. A plain boolean cannot tell
 * "turned it off" from "never touched it" — which is exactly how the old rule
 * overrode people.
 */
export function resolveLamination(
  chosen: boolean | null | undefined,
  logoColors: number,
): boolean {
  return chosen ?? suggestsLamination(logoColors);
}

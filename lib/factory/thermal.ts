/**
 * "שומר קור" — the thermal / cooler lining add-on, in one place.
 *
 * Eli, 2026-09-10: +10% on the BAG's cost — base + colours + handles +
 * lamination, i.e. everything the factory charges for the bag itself. Never on
 * shipping (pass-through), the plate fee or the molds. So each engine applies
 * `thermalMultiplier` at exactly one line, around the bag cost and nothing else:
 *   calculator/engine.ts  → (base + colour add-on) × m, plate term outside
 *   pricing.ts            → factoryUnitCostCny × m
 * The estimator is NOT touched: its cost always ends in one of those two, so the
 * flag rides the form and is applied once — multiplying in both would be ×1.21.
 *
 * Manual calculators only. The bot never offers it (a cold questionnaire lead
 * does not ask for insulation); the public website and the 3D configurator
 * don't either, for now.
 *
 * How it travels. Handles and lamination already ride as text inside the
 * spec's `finishing` ("With handles / Laminated"), and every consumer reads
 * them back by regex. Thermal joins the same string. That is deliberate: every
 * Zod schema that validates a saved spec enumerates its fields and would STRIP a
 * new key silently — the way the manual calculator's ¥ was once lost on save —
 * while the string passes through untouched and reaches the factory's sheet, so
 * they see we asked for it.
 *
 * Pure and dependency-free so client components can import it.
 */

export const THERMAL_LINING_PCT = 10;
export const THERMAL_LABEL = "שומר קור";
/** What the factory reads in the finishing column. */
export const THERMAL_FINISHING_TOKEN = "Thermal lining";

export function thermalMultiplier(on?: boolean | null): number {
  return on ? 1 + THERMAL_LINING_PCT / 100 : 1;
}

/** Does this finishing string carry the thermal lining? */
export function hasThermal(finishing: string | null | undefined): boolean {
  return /thermal\s*lining/i.test(finishing ?? "");
}

/** Append (or keep) the token — idempotent, so a re-save never doubles it. */
export function withThermalToken(finishing: string, on: boolean): string {
  const base = (finishing ?? "").replace(/\s*\/\s*thermal\s*lining/gi, "").replace(/^thermal\s*lining\s*\/?\s*/i, "").trim();
  if (!on) return base;
  return base ? `${base} / ${THERMAL_FINISHING_TOKEN}` : THERMAL_FINISHING_TOKEN;
}

/**
 * Does a factory's own text suggest it ALREADY priced an insulated bag?
 * Used only to warn on the finalize screen, where the price is the factory's:
 * if we asked them for a thermal bag, the lining is in their number already and
 * our +10% would charge the customer twice. 保温 = insulated, 铝箔 = aluminium
 * foil (the 07/09 cooler-bag quote said 铝箔平口保温袋), 冷 = cold.
 */
export function looksAlreadyThermal(...texts: Array<string | null | undefined>): boolean {
  const s = texts.filter(Boolean).join(" ");
  return /保温|铝箔|保冷|冷藏|thermal|insulat|cooler|שומר\s*קור|תרמי|בידוד/i.test(s);
}

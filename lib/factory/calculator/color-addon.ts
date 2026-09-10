/**
 * The per-bag colour add-on, including colour counts the table has no row for.
 *
 * Where the numbers come from. Without lamination the supplier prices every
 * colour count as its own per-bag price — each colour is another printing pass
 * on every bag — and our tables are those differences: rows for 1, 2 and 3
 * colours only (constants.ts DEFAULT_COLOR_ADDONS = the average over the 14
 * size tabs of Feishu sheet PBKystZ1dhCsZgtp4qgc2nzxnMf; the estimator's `color`
 * / `lamColor` records are fitted the same way). The supplier's sheet has NO
 * 4-colour row anywhere, laminated or not.
 *
 * Why it matters now. While 3+ colours forced lamination, an unlaminated
 * 4-colour bag could not exist. From 2026-09-10 lamination is only a default at
 * 4+, and such a bag fell through `colorAddons.find()` to ¥0 — priced exactly
 * like a ONE-colour bag — while the estimator clamped it to 3.
 *
 * Rule (Eli, 2026-09-10): past the end of the table, each extra colour adds the
 * same step the last known colour added. At 5,000 the 3rd colour adds ¥0.12,
 * so 4 colours = ¥0.33, 5 = ¥0.45.
 *
 * ⚠️ AN ESTIMATE, NOT A FACTORY PRICE. Replace it with the real figure once
 * Simon gets one from the factory — the fix is a 4-colour row in the table,
 * which this function then uses as-is.
 */

/**
 * @param known  colour count → per-bag add-on, for the counts the table has.
 * @param colors the colour count being priced.
 */
export function colorAddonFromTable(
  known: Map<number, number>,
  colors: number,
): number {
  const n = Math.max(1, Math.floor(Number(colors) || 1));
  const hit = known.get(n);
  if (hit !== undefined) return hit;

  const keys = [...known.keys()].sort((a, b) => a - b);
  if (!keys.length) return 0;
  const top = keys[keys.length - 1];

  if (n < top) {
    // Inside the table but this count has no row: take the next count up.
    // That is what every caller did before (`color["2"] ?? color["3"]`).
    const next = keys.find((k) => k > n)!;
    return known.get(next)!;
  }

  // Past the table: continue the last step.
  const topVal = known.get(top)!;
  if (keys.length < 2) return topVal;
  const prevKey = keys[keys.length - 2];
  const step = Math.max(0, (topVal - known.get(prevKey)!) / (top - prevKey));
  return topVal + (n - top) * step;
}

/** A `{ "2": x, "3": y }` record as a table. One colour is always ¥0. */
export function colorTableFromRecord(
  rec: Record<string, number> | null | undefined,
): Map<number, number> {
  const table = new Map<number, number>([[1, 0]]);
  for (const [k, v] of Object.entries(rec ?? {})) {
    const n = Number(k);
    if (Number.isFinite(n) && n >= 1 && typeof v === "number") table.set(n, v);
  }
  return table;
}

/**
 * Non-woven bag geometry rules — the physical limits of the factory's machine.
 * From the factory (Eli 2026-07-22). W = width, D = gusset/depth, H = height, cm.
 *
 *   - D (gusset):  9 ≤ D ≤ 39          (skipped when D === 0 → a flat bag)
 *   - W (width):   W > D  and  W ≤ 53
 *   - H (height):  18 ≤ H ≤ min(D/2 + 35, 55)
 *
 * Factory's own example: D=10 → max H = 10/2 + 35 = 40. Since max D is 39, the
 * D/2+35 term tops out at ~54.5, so the 55 is just a hard ceiling.
 *
 * A hard block: any non-empty return means the calculator must refuse to price
 * until the size is fixed (Eli chose block over warn — the factory literally
 * can't make it).
 */

export const BAG_MAX_WIDTH_CM = 53;
export const BAG_MIN_DEPTH_CM = 9;
export const BAG_MAX_DEPTH_CM = 39;
export const BAG_MIN_HEIGHT_CM = 18;
export const BAG_MAX_HEIGHT_HARD_CM = 55;

/** Max height allowed for a given gusset D: min(D/2 + 35, 55). */
export function maxHeightForDepth(depthCm: number): number {
  return Math.min(depthCm / 2 + 35, BAG_MAX_HEIGHT_HARD_CM);
}

/**
 * Validate a bag's geometry against the factory's machine limits.
 * Returns a list of Hebrew violation messages; an empty array means OK.
 * Non-positive / missing dimensions are treated as "not filled yet" and skipped
 * (so the caller's own required-field checks own that), EXCEPT depth 0 which is a
 * legitimate flat bag and only skips the depth-specific rules.
 */
export function validateBagGeometry(
  widthCm: number,
  depthCm: number,
  heightCm: number,
): string[] {
  const errs: string[] = [];
  const w = Number(widthCm);
  const d = Number(depthCm);
  const h = Number(heightCm);

  const hasW = Number.isFinite(w) && w > 0;
  const hasH = Number.isFinite(h) && h > 0;
  // depth may legitimately be 0 (flat bag); treat only NaN/negative as "unfilled"
  const dFilled = Number.isFinite(d) && d >= 0;
  const isFlat = dFilled && d === 0;

  // Gusset (depth) rules — skip entirely for a flat bag.
  if (dFilled && !isFlat) {
    if (d < BAG_MIN_DEPTH_CM || d > BAG_MAX_DEPTH_CM) {
      errs.push(`עומק (מכפל) חייב להיות בין ${BAG_MIN_DEPTH_CM} ל‑${BAG_MAX_DEPTH_CM} ס״מ (הוזן ${d})`);
    }
  }

  // Width rules.
  if (hasW) {
    if (w > BAG_MAX_WIDTH_CM) {
      errs.push(`רוחב מקסימלי ${BAG_MAX_WIDTH_CM} ס״מ (הוזן ${w})`);
    }
    if (dFilled && !isFlat && !(w > d)) {
      errs.push(`הרוחב חייב להיות גדול מהעומק (רוחב ${w} ≤ עומק ${d})`);
    }
  }

  // Height rules.
  if (hasH) {
    if (h < BAG_MIN_HEIGHT_CM) {
      errs.push(`גובה מינימלי ${BAG_MIN_HEIGHT_CM} ס״מ (הוזן ${h})`);
    }
    // Max height depends on the gusset; only enforce when depth is known.
    if (dFilled) {
      const maxH = maxHeightForDepth(d);
      if (h > maxH) {
        errs.push(
          `גובה מקסימלי למכפל ${d} ס״מ הוא ${maxH} ס״מ (½·${d}+35, עד ${BAG_MAX_HEIGHT_HARD_CM}) — הוזן ${h}`,
        );
      }
    } else if (h > BAG_MAX_HEIGHT_HARD_CM) {
      errs.push(`גובה מקסימלי ${BAG_MAX_HEIGHT_HARD_CM} ס״מ (הוזן ${h})`);
    }
  }

  return errs;
}

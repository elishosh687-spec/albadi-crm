/**
 * The closest bag we DO have a price for.
 *
 * A competitor quotes a size that is not in our catalogue and that the
 * estimator refuses (flat or otherwise outside what it was fitted on), and the
 * comparison ends there — חביב's whole ten-row matrix sat with no number
 * against it. But we hold real prices for sizes a few centimetres away, and a
 * price for a bag 4% smaller is far more use than no price at all, PROVIDED
 * the screen says which bag it is.
 *
 * Ranked on the two things that actually drive the cost, not on raw
 * centimetres: the fabric AREA of the cut sheet sets the production cost, and
 * the VOLUME sets the shipping. Ranking on dimensions alone would call a tall
 * narrow bag close to a short wide one.
 */
import { DEFAULT_CONFIG } from "./calculator/constants";

export interface NearestSize {
  productId: string;
  /** "40×15×45" — H×D×W, the way competitor sizes are written in the table. */
  label: string;
  /** Signed: +4 means our proxy has 4% MORE fabric than the size asked for. */
  areaPct: number;
  volPct: number;
}

/** Fabric in the cut sheet of a gusseted bag: two faces, two gussets, a base. */
function areaCm2(h: number, d: number, w: number): number {
  return 2 * w * h + 2 * d * h + d * w;
}
function volumeCm3(h: number, d: number, w: number): number {
  return w * h * Math.max(d, 1);
}

function parseDims(s: string): { h: number; d: number; w: number } | null {
  const g = (k: string) => {
    const m = s.match(new RegExp(k + "(\\d+(?:\\.\\d+)?)"));
    return m ? Number(m[1]) : 0;
  };
  const h = g("H");
  const w = g("W");
  if (!h || !w) return null;
  return { h, d: g("D"), w };
}

/**
 * Nothing further than this counts as "similar" — past it the number stops
 * being informative and starts being a guess wearing a label.
 */
const MAX_COMBINED_DRIFT = 0.35;

export function nearestCatalogSize(
  h: number,
  d: number,
  w: number
): NearestSize | null {
  if (!h || !w) return null;
  const targetArea = areaCm2(h, d, w);
  const targetVol = volumeCm3(h, d, w);

  let best: (NearestSize & { score: number }) | null = null;
  for (const p of DEFAULT_CONFIG.products) {
    const dims = parseDims(p.dimensions);
    if (!dims) continue;
    // A flat bag is not a proxy for a gusseted one and vice versa — the make
    // is different, not just the measurements.
    if ((dims.d > 0) !== (d > 0)) continue;
    const a = areaCm2(dims.h, dims.d, dims.w);
    const v = volumeCm3(dims.h, dims.d, dims.w);
    const areaPct = (a - targetArea) / targetArea;
    const volPct = (v - targetVol) / targetVol;
    const score = Math.abs(areaPct) + Math.abs(volPct);
    if (score > MAX_COMBINED_DRIFT) continue;
    if (!best || score < best.score) {
      best = {
        productId: p.id,
        label: dims.d > 0 ? `${dims.h}×${dims.d}×${dims.w}` : `${dims.h}×${dims.w}`,
        areaPct: Math.round(areaPct * 100),
        volPct: Math.round(volPct * 100),
        score,
      };
    }
  }
  if (!best) return null;
  const { score: _drop, ...out } = best;
  return out;
}

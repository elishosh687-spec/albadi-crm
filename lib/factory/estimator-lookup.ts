/**
 * Hybrid estimator — LOOKUP + INTERPOLATION layer (Phase 1, v2.2 plan).
 *
 * Pure, DB-free. Operates on a UNIFIED anchor pool of STANDARD price-list rows
 * only (factory identity irrelevant). Priority: (1) exact list price → (2)
 * feature-kNN size interpolation + monotone quantity interpolation → else the
 * caller falls back to the existing regression.
 *
 * Scope (Eli 2026-07-02): predicts the FACTORY UNIT price only (CNY). Shipping
 * and the operator's own markups are added downstream, unchanged. Colours are
 * priced PER-COLOUR from the catalog and extrapolated linearly beyond 3 (no hard
 * cap). Plate fee (版费) is a separate one-time line, never in the unit.
 *
 * All thresholds are FROZEN here (pre-registered) and must not be tuned to
 * validation results.
 */

import { DEFAULT_CONFIG } from "./calculator/constants";

export interface LookupAnchor {
  h: number; w: number; d: number; area: number; // area = 2HW+2HD+WD
  handles: boolean;
  lam: boolean;
  colors: number | null; // 1..3, or null (combined/unknown)
  qty: number;
  unitCny: number; // 1-colour base price for its (size, handle, lam, qty)
  platePerColorCny?: number | null;
  cartonQty?: number | null;
  cbmPerUnitM3?: number | null;
}

export interface LookupQuery {
  h: number; w: number; d: number;
  qty: number;
  handles: boolean;
  lam: boolean;
  colors: number; // 1..N
}

export interface LookupThresholds {
  exactCm: number; // ≤ this on each of W/H/D counts as the same size
  maxFeatureDistance: number; // normalized (0..~1) cap for a usable neighbour
  minDistinctSizes: number; // need at least this many bracketing sizes to interpolate
  minQty: number;
  maxQty: number;
  k: number; // nearest size clusters blended
}

// FROZEN — pre-registered before validation (plan §"frozen thresholds").
export const DEFAULT_LOOKUP_THRESHOLDS: LookupThresholds = {
  exactCm: 0.1,
  maxFeatureDistance: 0.28, // normalized; roughly "within a modest size step"
  minDistinctSizes: 2,
  minQty: 3000,
  maxQty: 10000,
  k: 4,
};

export interface LookupResult {
  ok: boolean;
  refused?: string;
  source?: "exact" | "interp";
  unitLow?: number;
  unitExpected?: number;
  unitHigh?: number; // raw spread only; the calibrated safe price is applied by the caller
  baseExpectedCny?: number; // 1-colour base before colour add-on (for debugging)
  colorAddCny?: number;
  confidence?: "high" | "medium" | "low";
  nUsed?: number; // distinct sizes contributing
  reasoning?: string[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ADDON_TIERS = [1000, 3000, 5000, 10000];

function snapAddonTier(q: number): number {
  let t = ADDON_TIERS[0];
  for (const x of ADDON_TIERS) if (x <= q) t = x;
  return t;
}

/** Per-unit colour add-on (CNY), from the catalog colour table, linear beyond 3.
 *  Matches the live engine's per-colour pricing; extrapolates for colours ≥ 4. */
export function colorAddonCny(colors: number, qty: number): number {
  if (colors <= 1) return 0;
  const t = String(snapAddonTier(qty));
  const table = DEFAULT_CONFIG.colorAddons;
  const at = (c: number) => table.find((x) => x.colors === c)?.pricesByQuantity[t] ?? 0;
  const a2 = at(2), a3 = at(3);
  if (colors === 2) return a2;
  if (colors === 3) return a3;
  // colours > 3 → linear per-colour extrapolation beyond the measured 3.
  return Math.max(0, a3 + (a3 - a2) * (colors - 3));
}

export function bagArea(h: number, d: number, w: number): number {
  return 2 * h * w + 2 * h * d + w * d;
}

function sizeKey(a: { h: number; w: number; d: number }): string {
  return `${a.h}x${a.w}x${a.d}`;
}

/** Monotone quantity interpolation within one size cluster. No extrapolation
 *  beyond the cluster's own [minQty,maxQty]; clamp so more qty never costs more. */
function qtyInterp(points: { qty: number; unitCny: number }[], qty: number): number | null {
  if (!points.length) return null;
  const ps = points
    .slice()
    .sort((a, b) => a.qty - b.qty)
    // enforce monotone non-increasing price as qty rises (guards dirty rows)
    .reduce<{ qty: number; unitCny: number }[]>((acc, p) => {
      if (acc.length && p.unitCny > acc[acc.length - 1].unitCny) {
        acc.push({ qty: p.qty, unitCny: acc[acc.length - 1].unitCny });
      } else acc.push(p);
      return acc;
    }, []);
  const lo = ps[0], hi = ps[ps.length - 1];
  if (qty <= lo.qty) return lo.unitCny; // clamp (smaller qty ⇒ higher price ⇒ conservative)
  if (qty >= hi.qty) return hi.unitCny;
  for (let i = 1; i < ps.length; i++) {
    if (qty <= ps[i].qty) {
      const a = ps[i - 1], b = ps[i];
      const t = (qty - a.qty) / (b.qty - a.qty);
      return a.unitCny + t * (b.unitCny - a.unitCny);
    }
  }
  return hi.unitCny;
}

function featureVec(h: number, w: number, d: number): number[] {
  return [2 * h * w, 2 * h * d + w * d, h / (w || 1), d / (w || 1)];
}

/**
 * Look up / interpolate the factory unit price for a query against the standard
 * anchor pool. Returns { ok:false } (with a refuse reason) when it can't answer
 * confidently — the caller then falls back to the regression.
 */
export function estimateUnitFromLookup(
  q: LookupQuery,
  anchors: LookupAnchor[],
  th: LookupThresholds = DEFAULT_LOOKUP_THRESHOLDS,
): LookupResult {
  const reasoning: string[] = [];
  if (q.qty < th.minQty || q.qty > th.maxQty) {
    return { ok: false, refused: `כמות ${q.qty} מחוץ לטווח ${th.minQty}-${th.maxQty} — שלח למפעל` };
  }

  // variant match: handles + lamination hard; colours priced separately, so the
  // BASE surface uses 1-colour (or unknown-colour) rows only.
  const pool = anchors.filter(
    (a) => a.handles === q.handles && a.lam === q.lam && (a.colors == null || a.colors === 1),
  );
  if (pool.length === 0) {
    return { ok: false, refused: "אין עוגני מחירון סטנדרטיים לצירוף הזה — שלח למפעל" };
  }

  const colorAdd = q.lam ? 0 : colorAddonCny(q.colors, q.qty); // lam colours go via plate fee
  const plate = q.lam
    ? (pool.map((a) => a.platePerColorCny).find((p) => p != null && p! > 0) ?? null)
    : null;

  // group by size, qty-interpolate each size to the target quantity
  const bySize = new Map<string, LookupAnchor[]>();
  for (const a of pool) {
    const k = sizeKey(a);
    (bySize.get(k) ?? bySize.set(k, []).get(k)!).push(a);
  }
  type SizePoint = { h: number; w: number; d: number; area: number; unit: number; exactQty: boolean };
  const sizePoints: SizePoint[] = [];
  for (const [, rows] of bySize) {
    const unit = qtyInterp(rows.map((r) => ({ qty: r.qty, unitCny: r.unitCny })), q.qty);
    if (unit == null) continue;
    sizePoints.push({
      h: rows[0].h, w: rows[0].w, d: rows[0].d, area: rows[0].area,
      unit,
      exactQty: rows.some((r) => r.qty === q.qty),
    });
  }
  if (sizePoints.length === 0) {
    return { ok: false, refused: "אין מחיר בטווח הכמות למידה הזו — שלח למפעל" };
  }

  // (1) EXACT — same size (≤exactCm on each dim) AND an exact quantity row
  const exact = sizePoints.filter(
    (s) => s.exactQty && Math.abs(s.w - q.w) <= th.exactCm && Math.abs(s.h - q.h) <= th.exactCm && Math.abs(s.d - q.d) <= th.exactCm,
  );
  if (exact.length >= 1) {
    const prices = exact.map((s) => s.unit).sort((a, b) => a - b);
    const base = prices[Math.floor(prices.length / 2)]; // median of the raw list prices
    const unit = base + colorAdd;
    reasoning.push(`exact: ${exact.length} מחיר/ים גולמי/ים למידה הזו, חציון ¥${r3(base)}`);
    if (colorAdd > 0) reasoning.push(`+ ${q.colors} צבעים = ¥${r3(colorAdd)}`);
    return {
      ok: true, source: "exact",
      unitLow: r3(prices[0] + colorAdd), unitExpected: r3(unit), unitHigh: r3(prices[prices.length - 1] + colorAdd),
      baseExpectedCny: r3(base), colorAddCny: r3(colorAdd),
      confidence: q.colors > 3 ? "medium" : "high", nUsed: exact.length, reasoning,
    };
  }

  // (2) INTERPOLATION — feature-kNN over size, within the same variant.
  // envelope guard: H, W, D each inside the pool's observed range.
  const hs = sizePoints.map((s) => s.h), ws = sizePoints.map((s) => s.w), ds = sizePoints.map((s) => s.d);
  const inEnvelope =
    q.h >= Math.min(...hs) && q.h <= Math.max(...hs) &&
    q.w >= Math.min(...ws) && q.w <= Math.max(...ws) &&
    q.d >= Math.min(...ds) && q.d <= Math.max(...ds);
  if (!inEnvelope) {
    return { ok: false, refused: "המידה מחוץ למעטפת המחירון — שלח למפעל" };
  }

  // normalize features by pool range, compute distance
  const qf = featureVec(q.h, q.w, q.d);
  const feats = sizePoints.map((s) => featureVec(s.h, s.w, s.d));
  const dims = qf.length;
  const mins = Array.from({ length: dims }, (_, j) => Math.min(qf[j], ...feats.map((f) => f[j])));
  const maxs = Array.from({ length: dims }, (_, j) => Math.max(qf[j], ...feats.map((f) => f[j])));
  const norm = (v: number[]) => v.map((x, j) => (maxs[j] > mins[j] ? (x - mins[j]) / (maxs[j] - mins[j]) : 0));
  const qn = norm(qf);
  const scored = sizePoints
    .map((s, i) => {
      const fn = norm(feats[i]);
      const dist = Math.sqrt(fn.reduce((acc, x, j) => acc + (x - qn[j]) ** 2, 0) / dims);
      return { s, dist };
    })
    .filter((x) => x.dist <= th.maxFeatureDistance)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, th.k);

  const distinctSizes = new Set(scored.map((x) => sizeKey(x.s))).size;
  if (distinctSizes < th.minDistinctSizes) {
    return { ok: false, refused: "אין מספיק עוגנים קרובים לאינטרפולציה — שלח למפעל" };
  }

  // inverse-distance-weighted blend of the qty-interpolated base prices
  const eps = 1e-4;
  let wsum = 0, acc = 0;
  const pool2: number[] = [];
  for (const { s, dist } of scored) {
    const wgt = 1 / (dist + eps);
    acc += wgt * s.unit;
    wsum += wgt;
    pool2.push(s.unit);
  }
  const base = acc / wsum;
  const unit = base + colorAdd;
  pool2.sort((a, b) => a - b);
  reasoning.push(`interp: ${distinctSizes} מידות עוגן קרובות (משוקלל לפי מרחק), בסיס ¥${r3(base)}`);
  if (colorAdd > 0) reasoning.push(`+ ${q.colors} צבעים = ¥${r3(colorAdd)}`);

  return {
    ok: true, source: "interp",
    unitLow: r3(pool2[0] + colorAdd),
    unitExpected: r3(unit),
    unitHigh: r3(pool2[pool2.length - 1] + colorAdd),
    baseExpectedCny: r3(base), colorAddCny: r3(colorAdd),
    confidence: q.colors > 3 ? "medium" : "high",
    nUsed: distinctSizes, reasoning,
  };
}

/**
 * Self-quote estimator — predict a factory unit cost (CNY) for an arbitrary 80g
 * bag from the per-factory coefficients (lib/factory/estimator-config.ts, fitted
 * from the live Feishu tables). Picks the CHEAPEST factory that actually makes
 * the spec and names it; refuses (→ factory) out-of-range / unknown / unsupported.
 *
 * Returns ONLY the per-unit factory CNY + a carton estimate + a human reasoning
 * trail. The full ILS quote is produced by handing this to `priceFactoryQuote`
 * (margin + shipping) — no margin/shipping logic is duplicated here.
 */

import { getEstimatorCoeffs, type EstimatorCoeffs, type FactoryCoef } from "./estimator-config";
import { DEFAULT_CONFIG } from "./calculator/constants";

const TIERS = [3000, 5000, 10000] as const;

export interface EstimateSpec {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  quantity: number;
  hasHandles: boolean;
  hasLamination: boolean;
  logoColors: number; // 1..3+
}

export interface EstimateBreakdown {
  baseCny: number;
  colorCny: number;
  handleCny: number;
  lamCny: number;
}

export interface CartonEstimate {
  qty: number; weightKg: number; lengthCm: number; widthCm: number; heightCm: number;
}

export interface EstimateResult {
  ok: boolean;
  refused?: string;            // reason → route to factory
  factoryName?: string;
  factoryUnitCostCny?: number; // base + colors + handle + lam (per unit; NO plate fee)
  plateFeeOneTimeCny?: number; // 版费, separate one-time line (× colors)
  breakdown?: EstimateBreakdown;
  carton?: CartonEstimate;
  confidence?: "high" | "medium" | "low";
  reasoning?: string[];        // step-by-step logic, shown to the operator
  areaCm2?: number;
  tier?: number;
  candidates?: { factory: string; unitCny: number; inRange: boolean }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function bagAreaCm2(h: number, d: number, w: number): number {
  return 2 * h * w + 2 * h * d + w * d;
}
function snapTier(q: number): number { let t = TIERS[0] as number; for (const x of TIERS) if (x <= q) t = x; return t; }

/** Nearest catalog product by surface area → its carton (physical packing data,
 *  used only for shipping CBM/weight; not a price). */
function nearestCarton(area: number, hasHandles: boolean): CartonEstimate | null {
  let best: { area: number; carton: CartonEstimate } | null = null;
  for (const p of DEFAULT_CONFIG.products) {
    const m = p.dimensions.replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i);
    if (!m) continue;
    const a = bagAreaCm2(+m[1], m[2] ? +m[2] : 0, +m[3]);
    const v = hasHandles ? p.withHandles : p.withoutHandles;
    const c = v.carton;
    const carton: CartonEstimate = { qty: c.qty, weightKg: c.weight, lengthCm: c.length, widthCm: c.width, heightCm: c.height };
    if (!best || Math.abs(a - area) < Math.abs(best.area - area)) best = { area: a, carton };
  }
  return best?.carton ?? null;
}

/** Max of an add-on across a factory's tiers — used as a fallback when a tier's
 *  own value is 0 (a data gap, e.g. 亚森 5000 n=2 with no handle/colour points).
 *  Add-ons are always a real cost, so a missing one must NOT drop to zero (that
 *  would under-quote); borrow the factory's typical value instead. */
function fallbackAddon(fc: FactoryCoef, pick: (t: FactoryCoef["tiers"][string]) => number, own: number): number {
  if (own > 0) return own;
  let best = 0; for (const t of Object.values(fc.tiers)) best = Math.max(best, pick(t));
  return best;
}

/** Per-factory unit CNY for a spec, or null if that factory can't make/model it. */
function predictFactory(fc: FactoryCoef, tier: number, spec: EstimateSpec, area: number): { unit: number; bd: EstimateBreakdown } | null {
  const t = fc.tiers[String(tier)];
  if (!t) return null;
  if (spec.hasLamination) {
    if (!t.lam) return null; // factory doesn't laminate (heat-press) → can't model
    const lamBase = t.lam.makeFee + t.lam.perCm2 * area;
    const handle = spec.hasHandles ? fallbackAddon(fc, (x) => x.lamHandle, t.lamHandle) : 0;
    return { unit: lamBase + handle, bd: { baseCny: r3(lamBase), colorCny: 0, handleCny: r3(handle), lamCny: 0 } };
  }
  if (!t.base) return null;
  const base = t.base.makeFee + t.base.perCm2 * area;
  const colorKey = String(Math.min(3, Math.max(1, spec.logoColors)));
  const color = spec.logoColors > 1 ? fallbackAddon(fc, (x) => x.color[colorKey] ?? x.color["3"] ?? 0, t.color[colorKey] ?? t.color["3"] ?? 0) : 0;
  const handle = spec.hasHandles ? fallbackAddon(fc, (x) => x.handle, t.handle) : 0;
  return { unit: base + color + handle, bd: { baseCny: r3(base), colorCny: r3(color), handleCny: r3(handle), lamCny: 0 } };
}

export async function estimateFactoryCny(spec: EstimateSpec, coeffsArg?: EstimatorCoeffs): Promise<EstimateResult> {
  const coeffs = coeffsArg ?? (await getEstimatorCoeffs());
  const area = bagAreaCm2(spec.heightCm, spec.depthCm, spec.widthCm);
  if (spec.quantity > coeffs.maxQty) {
    return { ok: false, refused: `כמות ${spec.quantity} מעל ${coeffs.maxQty} — שלח למפעל`, areaCm2: r2(area) };
  }
  const tier = snapTier(spec.quantity);

  const candidates: { factory: string; unitCny: number; inRange: boolean; bd: EstimateBreakdown; fc: FactoryCoef }[] = [];
  for (const [name, fc] of Object.entries(coeffs.factories)) {
    const p = predictFactory(fc, tier, spec, area);
    if (!p) continue;
    const inRange = area >= fc.areaMin * 0.9 && area <= fc.areaMax * 1.1;
    candidates.push({ factory: name, unitCny: p.unit, inRange, bd: p.bd, fc });
  }
  const summary = candidates.map((c) => ({ factory: c.factory, unitCny: r2(c.unitCny), inRange: c.inRange }));

  if (candidates.length === 0) {
    return { ok: false, refused: spec.hasLamination ? "אף מפעל מוכר לא מייצר למינציה בהדפסה למידה הזו — שלח למפעל" : "אין מפעל מוכר שמתמחר את הצירוף הזה — שלח למפעל", areaCm2: r2(area), tier, candidates: summary };
  }
  // prefer in-range; among them the cheapest. If none in range → still pick cheapest but flag low.
  const inRange = candidates.filter((c) => c.inRange);
  const pool = inRange.length ? inRange : candidates;
  const winner = pool.reduce((a, b) => (b.unitCny < a.unitCny ? b : a));
  const confidence: EstimateResult["confidence"] = !winner.inRange ? "low" : "high";

  if (confidence === "low") {
    return { ok: false, refused: `המידה (שטח ${Math.round(area)} ס״מ²) מחוץ לטווח הנתונים של ${winner.factory} — שלח למפעל`, areaCm2: r2(area), tier, candidates: summary };
  }

  const platePer = winner.fc.plateFeePerColor ? Math.max(0, winner.fc.plateFeePerColor.makeFee + winner.fc.plateFeePerColor.perCm2 * area) : 0;
  const plateOneTime = spec.hasLamination ? r2(platePer * Math.max(1, spec.logoColors)) : 0;
  const carton = nearestCarton(area, spec.hasHandles);

  const reasoning: string[] = [
    `שטח השקית = 2·H·W + 2·H·D + W·D = 2·${spec.heightCm}·${spec.widthCm} + 2·${spec.heightCm}·${spec.depthCm} + ${spec.widthCm}·${spec.depthCm} = ${Math.round(area)} ס״מ²`,
    `מפעל נבחר: ${winner.factory} (הזול מבין ${candidates.length} שמייצרים, כמות ${tier})`,
    spec.hasLamination
      ? `חומר גלם + למינציה = ¥${winner.bd.baseCny.toFixed(3)}`
      : `חומר גלם (בסיס, 1 צבע) = ¥${winner.bd.baseCny.toFixed(3)}`,
  ];
  if (!spec.hasLamination && winner.bd.colorCny > 0) reasoning.push(`+ ${spec.logoColors} צבעים = ¥${winner.bd.colorCny.toFixed(3)}`);
  if (winner.bd.handleCny > 0) reasoning.push(`+ ידיות = ¥${winner.bd.handleCny.toFixed(3)}`);
  reasoning.push(`= עלות יחידה מהמפעל ¥${r2(winner.unitCny).toFixed(2)}`);
  if (plateOneTime > 0) reasoning.push(`版费 (${spec.logoColors} צבעים) = ¥${plateOneTime.toFixed(0)} — עלות חד‑פעמית בנפרד`);
  reasoning.push(`→ המרה לשקל + מרווח + שילוח מחושבים על בסיס עלות זו`);

  return {
    ok: true,
    factoryName: winner.factory,
    factoryUnitCostCny: r2(winner.unitCny),
    plateFeeOneTimeCny: plateOneTime,
    breakdown: winner.bd,
    carton: carton ?? undefined,
    confidence,
    reasoning,
    areaCm2: r2(area),
    tier,
    candidates: summary,
  };
}

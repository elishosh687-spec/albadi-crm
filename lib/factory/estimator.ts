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

import { getEstimatorCoeffs, DEFAULT_CARTON_COEF, type EstimatorCoeffs, type FactoryCoef, type CartonCoef } from "./estimator-config";
import { colorAddonFromTable, colorTableFromRecord } from "./calculator/color-addon";
import { getFactoryConfig } from "./config";

const TIERS = [3000, 5000, 10000] as const;

// Shipping safety buffer — % added to the physical CBM/bag so we rarely
// under-quote pass-through shipping. Set 2026-07-02 as 15%/30% on 2 quotes;
// re-measured 2026-09-09 on 44 factory cartons: the raw model sits 5–9% under,
// 15% centres plain bags at +4.6%, and 30% on laminated bags put 10 of 15
// quotes 10–45% OVER (laminated 10% → +4%). Live values come from the factory
// config (settings screen); these are only the fallback.
const DEFAULT_SHIPPING_BUFFER_BASE = 0.15;
const DEFAULT_SHIPPING_BUFFER_LAM = 0.10;
// Below the first price tier the catalog has no data and factories quote small
// runs at 1.5–2× — the 1,000-qty rows in the quote log sit 50% above the model.
const MIN_QTY = 3000;

export interface EstimateSpec {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  quantity: number;
  hasHandles: boolean;
  hasLamination: boolean;
  logoColors: number; // 1..3+
  /**
   * How the bag is made. Simon assigns factories by construction, not by
   * price (his table, verified on 44 quotes 2026-09-10): heat-press 3D → CHEN
   * or MANDY; heat-press 2D and any hand-sewn bag → WEIWEI or CHEN. Absent =
   * heat-press (Albadi's default product).
   */
  construction?: Construction;
}
export type Construction = "heat_press" | "sewing";
export const CONSTRUCTION_LABELS: Record<Construction, string> = { heat_press: "חום (heat-press)", sewing: "תפירה ידנית" };

/**
 * Which MODELLED factories may quote this bag, per Simon's classification.
 * CHEN (鼎驰) sits in every cell of his table but has no price model (the
 * catalog only carries Mandy + 亚森), so it never appears here; when the only
 * fit is CHEN the estimator refuses and the quote goes to the factory.
 */
export function allowedFactoriesFor(spec: Pick<EstimateSpec, "depthCm" | "construction">): string[] {
  const is3D = spec.depthCm > 2;
  const construction = spec.construction ?? "heat_press";
  if (construction === "heat_press") return is3D ? ["Mandy"] : ["亚森"];
  return ["亚森"]; // hand-sewn, 2D or 3D — Mandy does not sew
}

export interface EstimateBreakdown {
  baseCny: number;
  colorCny: number;
  handleCny: number;
  lamCny: number;
}

export interface CartonEstimate {
  qty: number; weightKg: number; lengthCm: number; widthCm: number; heightCm: number;
  cbmPerUnit: number;                  // m³/bag — the load-bearing, data-verified number
  confidence: "high" | "low";          // low ⇒ flat/tray/out-of-envelope → verify with factory
  weightApprox: boolean;               // true: rough fabric estimate (not factory-measured) — air only
}

export interface EstimateResult {
  ok: boolean;
  refused?: string;            // reason → route to factory
  factoryName?: string;
  factoryUnitCostCny?: number; // base + colors + handle + lam (per unit; NO plate fee)
  plateFeeOneTimeCny?: number; // 版费, total one-time = platePerColorCny × colors
  platePerColorCny?: number;   // 版费 per single colour (BEFORE × colors). The
                               // route wires this into the engine's
                               // laminationColorPlateFee so the engine handles
                               // plate fee on the same pass-through path used
                               // for catalog products.
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

/** Wine/bottle-style geometry the area model cannot price — see MIN_QTY note. */
export function isNarrowTall(s: { heightCm: number; depthCm: number; widthCm: number }): boolean {
  return s.depthCm > 0 && s.depthCm <= 10 && s.heightCm >= 1.5 * s.widthCm;
}
export function bagAreaCm2(h: number, d: number, w: number): number {
  return 2 * h * w + 2 * h * d + w * d;
}
function snapTier(q: number): number { let t = TIERS[0] as number; for (const x of TIERS) if (x <= q) t = x; return t; }

/**
 * Predict the packing for an arbitrary 80g bag (VERIFIED 2026-06-24).
 * Physics: a flat-stacked folded bag occupies `area × T` → CBM_per_unit(m³) = T_mm · area · 1e-7.
 * Units/carton + carton dims are derived from a standard export carton (the carton choice
 * cancels out of CBM/unit). Confidence is LOW for flat (D≤2) / tray (H<10) / out-of-envelope
 * geometries — there the area→thickness relation breaks (verified up to ~60% error), so the UI
 * flags "verify with factory". Weight is a ROUGH fabric estimate (air only) — never factory-grade.
 */
function predictCarton(area: number, spec: EstimateSpec, factory: string, cc: CartonCoef, bufferPct = 0): CartonEstimate {
  const tMm = cc.perFactoryTMm?.[factory] ?? cc.tMmGusseted;
  const flat = spec.depthCm <= 2;
  const tray = spec.heightCm < 10;
  const outOfRange = area < cc.areaMin || area > cc.areaMax;
  const confidence: "high" | "low" = flat || tray || outOfRange ? "low" : "high";

  // Physical flat-stack CBM, then a safety buffer (pass-through shipping — never
  // want to under-quote). The buffer flows through qty/dims consistently: bigger
  // cbm/unit ⇒ fewer units/carton ⇒ more cartons ⇒ higher (safe) total CBM.
  const cbmPerUnit = tMm * area * 1e-7 * (1 + bufferPct);     // m³/bag (safe)
  const innerCm3 = cc.stdCartonCbm * cc.innerFactor * 1e6;    // usable carton volume, cm³
  const foldedCm3 = cbmPerUnit * 1e6;                         // one bag's packed volume, cm³
  const rawQty = foldedCm3 > 0 ? innerCm3 / foldedCm3 : cc.bundleSnap;
  const qty = Math.max(cc.bundleSnap, Math.round(rawQty / cc.bundleSnap) * cc.bundleSnap);

  const cartonCbm = cbmPerUnit * qty;                         // m³ — encodes cbmPerUnit exactly
  const f = Math.cbrt(cartonCbm / cc.stdCartonCbm);           // scale the 60×40×40 reference
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const lengthCm = r1(60 * f), widthCm = r1(40 * f), heightCm = r1(40 * f);

  // Rough weight (fabric area × 80gsm × seam overhead + handles) + carton tare. AIR only; flagged.
  const fabricKgPerBag = (area / 10000) * 0.08 * 1.1 + (spec.hasHandles ? 0.006 : 0);
  const weightKg = Math.round((fabricKgPerBag * qty + 0.7) * 10) / 10;

  return { qty, weightKg, lengthCm, widthCm, heightCm, cbmPerUnit, confidence, weightApprox: true };
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
  if (spec.construction === "sewing") {
    // Hand-sewn: the catalog only prices sewn LAMINATED bags, and only at
    // 3,000 pcs — a bigger run is priced at that tier (conservative).
    if (!spec.hasLamination) return null;
    const st = t.sewnLam ? t : fc.tiers["3000"];
    if (!st?.sewnLam) return null;
    const base = st.sewnLam.makeFee + st.sewnLam.perCm2 * area;
    const handle = spec.hasHandles ? (st.sewnLamHandle ?? 0) : 0;
    return { unit: base + handle, bd: { baseCny: r3(base), colorCny: 0, handleCny: r3(handle), lamCny: 0 } };
  }
  if (spec.hasLamination) {
    if (!t.lam) return null; // factory doesn't laminate (heat-press) → can't model
    const lamBase = t.lam.makeFee + t.lam.perCm2 * area;
    // Per-unit laminated colour add-on. Empty today (no multi-colour lam price data) → colours
    // are priced via the per-colour 版费 (plate fee) below; this auto-activates if such data arrives.
    // Past 3 colours the step continues rather than clamping to 3 (color-addon.ts).
    const lamColor = spec.logoColors > 1 ? colorAddonFromTable(colorTableFromRecord(t.lamColor), spec.logoColors) : 0;
    const handle = spec.hasHandles ? fallbackAddon(fc, (x) => x.lamHandle, t.lamHandle) : 0;
    return { unit: lamBase + lamColor + handle, bd: { baseCny: r3(lamBase), colorCny: r3(lamColor), handleCny: r3(handle), lamCny: 0 } };
  }
  if (!t.base) return null;
  const base = t.base.makeFee + t.base.perCm2 * area;
  // Past 3 colours the step continues rather than clamping to 3 (color-addon.ts):
  // an unlaminated 4-colour bag used to be priced exactly like a 3-colour one.
  const colorOf = (rec: Record<string, number> | undefined) =>
    colorAddonFromTable(colorTableFromRecord(rec), spec.logoColors);
  const color = spec.logoColors > 1 ? fallbackAddon(fc, (x) => colorOf(x.color), colorOf(t.color)) : 0;
  const handle = spec.hasHandles ? fallbackAddon(fc, (x) => x.handle, t.handle) : 0;
  return { unit: base + color + handle, bd: { baseCny: r3(base), colorCny: r3(color), handleCny: r3(handle), lamCny: 0 } };
}

export async function estimateFactoryCny(
  spec: EstimateSpec,
  coeffsArg?: EstimatorCoeffs,
  opts?: { measure?: boolean }, // measure=true → RAW model: no shipping buffer, no flat/tray refuse (for validation only)
): Promise<EstimateResult> {
  const coeffs = coeffsArg ?? (await getEstimatorCoeffs());
  const area = bagAreaCm2(spec.heightCm, spec.depthCm, spec.widthCm);
  // Absurd-quantity sanity bound: above this the anchor is meaningless — send to
  // the factory. Between coeffs.maxQty (trained ceiling, 10k) and here we ANCHOR:
  // price per-unit at the top tier and scale the total by the real quantity, then
  // downgrade confidence + note it (Eli 2026-07-22 — customers sometimes want 20k+).
  const SANE_MAX_QTY = 200_000;
  if (spec.quantity > SANE_MAX_QTY) {
    return { ok: false, refused: `כמות ${spec.quantity} חריגה (מעל ${SANE_MAX_QTY.toLocaleString("he-IL")}) — שלח למפעל`, areaCm2: r2(area) };
  }
  if (!opts?.measure && spec.quantity < MIN_QTY) {
    return { ok: false, refused: `כמות ${spec.quantity.toLocaleString("he-IL")} מתחת למינימום ${MIN_QTY.toLocaleString("he-IL")} — אין נתוני מחיר, שלח למפעל`, areaCm2: r2(area) };
  }
  // Narrow-and-tall gusseted bags (wine / bottle style: depth ≤ 10 cm, height ≥
  // 1.5× width) are a different construction — every one in the quote log came
  // in 40–50% ABOVE the area model (H50×D9×W33: ¥2.20 vs ¥1.12), and they are
  // also what pushed the refit over its accuracy gate. Send them to the factory.
  if (!opts?.measure && isNarrowTall(spec)) {
    return { ok: false, refused: "שקית צרה וגבוהה (עומק ≤ 10, גובה ≥ 1.5× רוחב) — המודל מפספס בצורה הזו, שלח למפעל", areaCm2: r2(area) };
  }
  const anchoredQty = spec.quantity > coeffs.maxQty;
  // snapTier already picks the largest tier ≤ qty (→ 10k for anything above),
  // but force the top TIER explicitly when anchoring so the intent is clear.
  const tier = anchoredQty ? (TIERS[TIERS.length - 1] as number) : snapTier(spec.quantity);

  const allowed = allowedFactoriesFor(spec);
  const candidates: { factory: string; unitCny: number; inRange: boolean; bd: EstimateBreakdown; fc: FactoryCoef }[] = [];
  for (const [name, fc] of Object.entries(coeffs.factories)) {
    // measure=true scores the raw model against a quote's ACTUAL supplier, so
    // the construction gate applies only to live quoting.
    if (!opts?.measure && !allowed.includes(name)) continue;
    const p = predictFactory(fc, tier, spec, area);
    if (!p) continue;
    const inRange = area >= fc.areaMin * 0.9 && area <= fc.areaMax * 1.1;
    candidates.push({ factory: name, unitCny: p.unit, inRange, bd: p.bd, fc });
  }
  const summary = candidates.map((c) => ({ factory: c.factory, unitCny: r2(c.unitCny), inRange: c.inRange }));

  if (candidates.length === 0) {
    const cons = CONSTRUCTION_LABELS[spec.construction ?? "heat_press"];
    const refused = (spec.construction ?? "heat_press") === "sewing"
      ? (spec.hasLamination
          ? "תפירה עם למינציה — אין עדיין מקדמי תפירה (הרץ כיול), שלח למפעל"
          : "שקית תפורה בלי למינציה — בקטלוג יש מחירי תפירה רק עם למינציה, שלח למפעל")
      : spec.hasLamination
        ? "אף מפעל מוכר לא מייצר למינציה בהדפסה למידה הזו — שלח למפעל"
        : `אין מפעל ממודל שמייצר ${cons} במידה הזו (המפעל המתאים לפי סיימון, CHEN, בלי טבלת מחירים) — שלח למפעל`;
    return { ok: false, refused, areaCm2: r2(area), tier, candidates: summary };
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
  let shippingBuffer = 0;
  if (!opts?.measure) {
    const cfg = await getFactoryConfig().catch(() => null);
    const pct = spec.hasLamination
      ? (cfg?.estimatorShippingBufferLamPct ?? DEFAULT_SHIPPING_BUFFER_LAM * 100)
      : (cfg?.estimatorShippingBufferPct ?? DEFAULT_SHIPPING_BUFFER_BASE * 100);
    shippingBuffer = Math.max(0, pct) / 100;
  }
  const carton = predictCarton(area, spec, winner.factory, coeffs.carton ?? DEFAULT_CARTON_COEF, shippingBuffer);

  // Flat / tray / out-of-envelope geometry → the CBM (hence shipping) is not
  // reliably estimable (Eli 2026-07-02: those always go to the factory). Refuse
  // rather than quote a shipping number we can't stand behind. Bypassed in
  // measure mode so the harness can score the raw model on those geometries too.
  if (!opts?.measure && carton.confidence === "low") {
    return { ok: false, refused: "צורה שטוחה/חריגה — השילוח לא ניתן לאמידה אמינה, שלח למפעל", areaCm2: r2(area), tier, candidates: summary };
  }

  const reasoning: string[] = [
    `שטח השקית = 2·H·W + 2·H·D + W·D = 2·${spec.heightCm}·${spec.widthCm} + 2·${spec.heightCm}·${spec.depthCm} + ${spec.widthCm}·${spec.depthCm} = ${Math.round(area)} ס״מ²`,
    `סוג ייצור: ${CONSTRUCTION_LABELS[spec.construction ?? "heat_press"]}${spec.depthCm > 2 ? " תלת-ממד" : " שטוח"} → לפי הטבלה של סיימון מתאים: ${allowed.join("/")}${" + CHEN (ללא טבלת מחירים)"}`,
    `מפעל נבחר: ${winner.factory} (כמות ${tier})`,
    spec.hasLamination
      ? `חומר גלם + למינציה = ¥${winner.bd.baseCny.toFixed(3)}`
      : `חומר גלם (בסיס, 1 צבע) = ¥${winner.bd.baseCny.toFixed(3)}`,
  ];
  if (!spec.hasLamination && winner.bd.colorCny > 0) reasoning.push(`+ ${spec.logoColors} צבעים = ¥${winner.bd.colorCny.toFixed(3)}`);
  if (spec.hasLamination && winner.bd.colorCny > 0) reasoning.push(`+ ${spec.logoColors} צבעים (למינציה) = ¥${winner.bd.colorCny.toFixed(3)}`);
  if (winner.bd.handleCny > 0) reasoning.push(`+ ידיות = ¥${winner.bd.handleCny.toFixed(3)}`);
  reasoning.push(`= עלות יחידה מהמפעל ¥${r2(winner.unitCny).toFixed(2)}`);
  if (plateOneTime > 0) {
    const perUnit = plateOneTime / Math.max(1, spec.quantity);
    reasoning.push(`版费 למינציה = ${spec.logoColors} צבעים × ¥${r2(platePer).toFixed(0)}/צבע = ¥${plateOneTime.toFixed(0)} חד‑פעמי (≈ ¥${perUnit.toFixed(3)}/יח׳ על ${spec.quantity.toLocaleString("he-IL")} יח׳)`);
  }
  reasoning.push(`→ המרה לשקל + מרווח + שילוח מחושבים על בסיס עלות זו`);
  if (anchoredQty) {
    reasoning.push(`⚠️ אומדן מבוסס על 10,000 יח׳ — מחיר היחידה נלקח משכבת ה‑10,000 (המקסימום שהמודל מתומחר עליו) והוכפל ב‑${spec.quantity.toLocaleString("he-IL")} יח׳. לאישור מול המפעל.`);
  }
  // Carton / packing reasoning (the shipping-volume driver).
  const cbmL = (carton.cbmPerUnit * 1000).toFixed(2); // litres/bag for readability
  if (carton.confidence === "high") {
    reasoning.push(`אריזה: שקית מקופלת ≈ שטח × ${(coeffs.carton ?? DEFAULT_CARTON_COEF).tMmGusseted} מ״מ → ${cbmL} ליטר/יח׳ (CBM ${carton.cbmPerUnit.toFixed(5)})`);
    reasoning.push(`→ קרטון ≈ ${carton.lengthCm}×${carton.widthCm}×${carton.heightCm} ס״מ, ${carton.qty} יח׳/קרטון (אומדן; דיוק ~±10%)`);
    reasoning.push(`כולל כרית ביטחון שילוח +${Math.round(shippingBuffer * 100)}% (שילוח pass-through — לא מציגים מחיר נמוך מדי)`);
  } else {
    reasoning.push(`⚠️ אריזה: צורה שטוחה/חריגה — אומדן הנפח לא אמין (עד ~60% סטייה). מומלץ לאמת את הקרטון מול המפעל`);
  }

  return {
    ok: true,
    factoryName: winner.factory,
    factoryUnitCostCny: r2(winner.unitCny),
    plateFeeOneTimeCny: plateOneTime,
    platePerColorCny: spec.hasLamination ? r2(platePer) : 0,
    breakdown: winner.bd,
    carton: carton ?? undefined,
    confidence: anchoredQty ? "medium" : confidence,
    reasoning,
    areaCm2: r2(area),
    tier,
    candidates: summary,
  };
}

/**
 * Estimator coefficient TYPES + fitted DEFAULTS — PURE module (no db, no env).
 *
 * Split out of `estimator-config.ts` (which imports `@/lib/db` and throws at
 * import time without DATABASE_URL) so tests and fixtures can use the default
 * fit without a database. `estimator-config.ts` re-exports everything here.
 */

export interface AffineCoef { makeFee: number; perCm2: number }
export interface TierCoef {
  base: AffineCoef | null;
  lam: AffineCoef | null;
  color: Record<string, number>;    // "2"|"3" → extra-colour add-on (non-lam)
  lamColor?: Record<string, number>; // "2"|"3" → extra-colour add-on for LAMINATED per-unit.
                                      // Empty today: our laminated data has no per-colour price
                                      // variants, so lamination colour cost lives entirely in the
                                      // per-colour 版费 (plate fee). Auto-fills if such quotes arrive.
  handle: number;
  lamHandle: number;
  /** Hand-sewn laminated line (车缝 catalog rows). 亚森 only; the catalog quotes
   *  sewing at 3000 pcs, so larger runs are priced at the 3000 tier. */
  sewnLam?: AffineCoef | null;
  sewnLamHandle?: number;
}
export interface FactoryCoef {
  areaMin: number;
  areaMax: number;
  plateFeePerColor: AffineCoef | null;
  tiers: Record<string, TierCoef>; // "3000"|"5000"|"10000"
}
/**
 * Carton / packing model (VERIFIED 2026-06-24, adversarial workflow wf_699152fc-834).
 * A flat-stacked folded bag occupies `area × T`, so CBM_per_unit (m³) = T_mm · area · 1e-7
 * (area = 2HW+2HD+WD cm²). Verified LOO on gusseted 80g bags: median ~6.8%, max ~12%.
 * WEIGHT is NOT modelled here — recorded carton weight is GROSS (box+handles, ~1.67× fabric)
 * and was not predictable from dimensions; the estimator shows a rough fabric weight only,
 * flagged, since SEA (≈90% of orders) is CBM-priced and weight only drives AIR.
 */
export interface CartonCoef {
  tMmGusseted: number;                       // 0.85 mm — stacked thickness per bag, gusseted
  tMmFlat: number | null;                    // flat (D≤2) bags scatter 0.52–1.6 mm → not formula-quotable
  perFactoryTMm?: Record<string, number>;    // 亚森 packs ~10% denser than Mandy/鼎驰
  stdCartonCbm: number;                       // 0.096 m³ (standard 60×40×40 export carton)
  innerFactor: number;                        // usable fraction of carton volume (~0.85)
  bundleSnap: number;                         // round units/carton to this multiple (25)
  areaMin: number;                            // fitted gusseted envelope (cm²)
  areaMax: number;
  accuracy?: { medianPct: number; maxPct: number; n: number } | null;
  fittedAt?: string;
}
export interface EstimatorCoeffs {
  version: number;
  areaFormula: string;
  material: string;
  maxQty: number;
  fittedAt?: string;
  accuracy?: { medianPct: number; maxPct: number; n: number } | null;
  factories: Record<string, FactoryCoef>;
  carton?: CartonCoef;
}

/** Verified carton default (workflow wf_699152fc-834): T=0.85mm gusseted; per-factory
 *  T from the ~10% inter-factory spread; flat bags route to manual (tMmFlat=null). */
export const DEFAULT_CARTON_COEF: CartonCoef = {
  tMmGusseted: 0.85,
  tMmFlat: null,
  perFactoryTMm: { "亚森": 0.78, Mandy: 0.84, "鼎驰": 0.83 },
  stdCartonCbm: 0.096,
  innerFactor: 0.85,
  bundleSnap: 25,
  areaMin: 1500,
  areaMax: 5400,
  accuracy: { medianPct: 6.8, maxPct: 12.0, n: 11 },
  fittedAt: "2026-06-24",
};

/** 2026-06-24 fit. 亚森 lamination is intentionally null (亚森 only laminates by
 *  sewing → route to factory; heat-press lamination ⇒ Mandy). */
export const DEFAULT_ESTIMATOR_COEFFS: EstimatorCoeffs = {
  version: 1,
  areaFormula: "2HW+2HD+WD",
  material: "80g",
  maxQty: 10000,
  fittedAt: "2026-06-24",
  accuracy: { medianPct: 4.0, maxPct: 7.6, n: 10 },
  factories: {
    Mandy: {
      areaMin: 1520,
      areaMax: 5950,
      plateFeePerColor: { makeFee: 0, perCm2: 0.10720813290084123 },
      tiers: {
        "3000": { base: { makeFee: 0.517, perCm2: 0.00020319621189701092 }, lam: { makeFee: 0.274, perCm2: 0.0003077282824739857 }, color: { "2": 0.08, "3": 0.25 }, handle: 0.03, lamHandle: 0.035 },
        "5000": { base: { makeFee: 0.311, perCm2: 0.00012142645753181417 }, lam: { makeFee: 0.183, perCm2: 0.0001854347798122783 }, color: { "2": 0.05, "3": 0.15 }, handle: 0.02, lamHandle: 0.02 },
        "10000": { base: { makeFee: 0.248, perCm2: 0.00012307692307692307 }, lam: { makeFee: 0.219, perCm2: 0.00016194895591647329 }, color: { "2": 0.05, "3": 0.15 }, handle: 0.02, lamHandle: 0.033 },
      },
    },
    "亚森": {
      areaMin: 1520,
      areaMax: 5950,
      plateFeePerColor: { makeFee: 427.105, perCm2: 0.031578947368421054 },
      tiers: {
        "3000": { base: { makeFee: 0.531, perCm2: 0.00011084298250753832 }, lam: null, color: { "2": 0.15, "3": 0.3 }, handle: 0.09, lamHandle: 0 },
        "5000": { base: { makeFee: 0.275, perCm2: 0.00012698412698412695 }, lam: null, color: { "2": 0, "3": 0 }, handle: 0, lamHandle: 0 },
        "10000": { base: { makeFee: 0.246, perCm2: 0.0001133703019100431 }, lam: null, color: { "2": 0.1, "3": 0.2 }, handle: 0.05, lamHandle: 0 },
      },
    },
  },
  carton: DEFAULT_CARTON_COEF,
};

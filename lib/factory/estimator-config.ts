/**
 * Per-factory self-quote estimator coefficients — stored as a single JSONB row
 * in `app_config` under key='factory_estimators'. Cached in-memory 60s.
 * Mirrors lib/factory/config.ts.
 *
 * The coefficients are FITTED from the two live Feishu tables by
 * `scripts/fit-estimator.ts` (catalog colours = factories + the custom quote-log).
 * The default below is the 2026-06-24 fit (LOO median 4.0%, max 7.6%). The fit
 * script (`--commit`) and the daily refit job overwrite this row as new factory
 * quotes arrive.
 *
 * Model (per factory, per qty tier), area = 2HW + 2HD + WD (cm²):
 *   base(area)  = makeFee + perCm2·area     (1-color, non-lam, no-handle)
 *   + color[c]  (logo-colour add-on, non-lam)
 *   + handle    (non-lam) / lamHandle (lam)
 *   lam(area)   = makeFee + perCm2·area     (laminated base; Mandy only)
 *   plate fee 版费 = SEPARATE one-time line per colour = plateFeePerColor(area)
 */

import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import type { EstimatorCoeffs } from "./estimator-defaults";
import { DEFAULT_ESTIMATOR_COEFFS } from "./estimator-defaults";

export type {
  AffineCoef,
  TierCoef,
  FactoryCoef,
  CartonCoef,
  EstimatorCoeffs,
} from "./estimator-defaults";
export { DEFAULT_CARTON_COEF, DEFAULT_ESTIMATOR_COEFFS } from "./estimator-defaults";

const KEY = "factory_estimators";
const TTL_MS = 60_000;


interface CacheEntry { value: EstimatorCoeffs; expiresAt: number }
let cache: CacheEntry | null = null;

export async function getEstimatorCoeffs(opts?: { fresh?: boolean }): Promise<EstimatorCoeffs> {
  const now = Date.now();
  if (!opts?.fresh && cache && cache.expiresAt > now) return cache.value;
  const rows = await db.select().from(appConfig).where(eq(appConfig.key, KEY)).limit(1);
  let value: EstimatorCoeffs;
  if (rows.length === 0) {
    await db.insert(appConfig).values({ key: KEY, value: DEFAULT_ESTIMATOR_COEFFS });
    value = DEFAULT_ESTIMATOR_COEFFS;
  } else {
    value = rows[0].value as EstimatorCoeffs;
  }
  cache = { value, expiresAt: now + TTL_MS };
  return value;
}

export async function setEstimatorCoeffs(value: EstimatorCoeffs): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date() } });
  cache = null;
}

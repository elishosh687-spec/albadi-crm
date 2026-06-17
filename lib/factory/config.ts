/**
 * Factory pricing config — stored as a single JSONB row in `app_config`
 * under key='factory_pricing'. Cached in-memory per process for 60s.
 */

import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import type { FactoryPricingConfig } from "./types";
import { YEADIM_CARRIER, DEFAULT_ASSUMED_SHIPMENT_CBM } from "./sea-carriers";

const KEY = "factory_pricing";
const TTL_MS = 60_000;

interface CacheEntry {
  value: FactoryPricingConfig;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

export const DEFAULT_FACTORY_CONFIG: FactoryPricingConfig = {
  shippingOptions: [
    {
      id: "sea-standard",
      name: "ים — סטנדרט",
      type: "sea",
      enabled: true,
      seaRate: 500, // USD per CBM — LEGACY fallback only; the active sea carrier
      // profile (seaCarriers) drives real sea pricing.
    },
    {
      id: "air-express",
      name: "אוויר — אקספרס",
      type: "air",
      enabled: true,
      airRates: {
        thresholdKg: 100,
        rateBelowThreshold: 8.5,
        rateAboveThreshold: 6.5,
      },
    },
  ],
  seaCarriers: [YEADIM_CARRIER],
  activeSeaCarrierId: YEADIM_CARRIER.id,
  assumedShipmentCbm: DEFAULT_ASSUMED_SHIPMENT_CBM,
  usdToIls: 3.7,
  usdToCny: 7.2,
  ilsToCny: 1.95,
  defaultProfitMargin: 40,
  profitMarginByQuantity: { "1000": 40, "3000": 40, "5000": 40, "10000": 40 },
  commissionPct: 10,
  currency: "ILS",
};

/**
 * Back-compat normalizer: rows written before `profitMarginByQuantity` existed
 * get the field initialized to `defaultProfitMargin` for every standard tier.
 * Pure function — does not mutate the input.
 */
function normalizeConfig(raw: FactoryPricingConfig): FactoryPricingConfig {
  let out = raw;

  // Backfill the per-quantity margin matrix (legacy rows predate it).
  if (!(out.profitMarginByQuantity && Object.keys(out.profitMarginByQuantity).length > 0)) {
    const fallback = out.defaultProfitMargin ?? 40;
    out = {
      ...out,
      profitMarginByQuantity: {
        "1000": fallback,
        "3000": fallback,
        "5000": fallback,
        "10000": fallback,
      },
    };
  }

  // Backfill sea carrier profiles (rows written before multi-carrier sea
  // pricing existed). Seed the Yeadim forwarder + the 3-CBM assumed basis so
  // existing prod configs start pricing sea correctly without a manual edit.
  if (!out.seaCarriers || out.seaCarriers.length === 0) {
    out = {
      ...out,
      seaCarriers: [YEADIM_CARRIER],
      activeSeaCarrierId: out.activeSeaCarrierId ?? YEADIM_CARRIER.id,
    };
  }
  if (out.assumedShipmentCbm === undefined) {
    out = { ...out, assumedShipmentCbm: DEFAULT_ASSUMED_SHIPMENT_CBM };
  }

  return out;
}

/**
 * @param opts.fresh — bypass the 60s in-process cache. Admin paths (settings,
 *   calculator) MUST pass this so a save on one Vercel container is visible
 *   when the next request lands on a different (warm) container that still
 *   holds a stale snapshot. Bot paths (cron, questionnaire) can tolerate the
 *   60s lag and benefit from the cache.
 */
export async function getFactoryConfig(opts?: { fresh?: boolean }): Promise<FactoryPricingConfig> {
  const now = Date.now();
  if (!opts?.fresh && cache && cache.expiresAt > now) return cache.value;

  const rows = await db.select().from(appConfig).where(eq(appConfig.key, KEY)).limit(1);
  let value: FactoryPricingConfig;
  if (rows.length === 0) {
    // Auto-seed on first read so the system has sane defaults without a manual step.
    await db.insert(appConfig).values({ key: KEY, value: DEFAULT_FACTORY_CONFIG });
    value = DEFAULT_FACTORY_CONFIG;
  } else {
    value = normalizeConfig(rows[0].value as FactoryPricingConfig);
  }
  cache = { value, expiresAt: now + TTL_MS };
  return value;
}

export async function setFactoryConfig(value: FactoryPricingConfig): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
  cache = null;
}

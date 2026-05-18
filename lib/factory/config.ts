/**
 * Factory pricing config — stored as a single JSONB row in `app_config`
 * under key='factory_pricing'. Cached in-memory per process for 60s.
 */

import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import type { FactoryPricingConfig } from "./types";

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
      seaRate: 500, // USD per CBM
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
  usdToIls: 3.7,
  usdToCny: 7.2,
  defaultProfitMargin: 40,
  profitMarginByQuantity: { "1000": 40, "3000": 40, "5000": 40, "10000": 40 },
  currency: "ILS",
};

/**
 * Back-compat normalizer: rows written before `profitMarginByQuantity` existed
 * get the field initialized to `defaultProfitMargin` for every standard tier.
 * Pure function — does not mutate the input.
 */
function normalizeConfig(raw: FactoryPricingConfig): FactoryPricingConfig {
  if (raw.profitMarginByQuantity && Object.keys(raw.profitMarginByQuantity).length > 0) {
    return raw;
  }
  const fallback = raw.defaultProfitMargin ?? 40;
  return {
    ...raw,
    profitMarginByQuantity: {
      "1000": fallback,
      "3000": fallback,
      "5000": fallback,
      "10000": fallback,
    },
  };
}

export async function getFactoryConfig(): Promise<FactoryPricingConfig> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

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

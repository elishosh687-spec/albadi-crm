/**
 * Shared pricing fixtures for the factory unit tests — PURE (no db, no env).
 *
 * Two FactoryPricingConfig shapes are needed because the sea path forks:
 *  - TIERED  → the default config (YEADIM carrier, assumed 3-CBM basis), the
 *              path production actually runs.
 *  - FLAT    → no carrier at all, so `computeShippingPerUnitUsd` falls to the
 *              legacy `max(cbm, 1) × seaRate` rule that the scratch scripts
 *              (`scripts/_price-foil-300.ts`, `scripts/_verify-air-volumetric.ts`)
 *              reason about by hand.
 * Plus the calculator engine's AppConfig (catalog products) and the
 * 2026-09-07 foil order that several tests price.
 */
import type { FactoryPricingConfig, FactoryPricingInput } from "@/lib/factory/types";
import type { AppConfig } from "@/lib/factory/calculator/types";
import { DEFAULT_FACTORY_CONFIG } from "@/lib/factory/config-defaults";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

/** Deep copy so a test that mutates its config can never leak into another. */
export function tieredFactoryConfig(
  overrides: Partial<FactoryPricingConfig> = {}
): FactoryPricingConfig {
  return { ...structuredClone(DEFAULT_FACTORY_CONFIG), ...overrides };
}

/** Strip the carrier so the flat $/CBM legacy rule applies, and set the rate
 *  (model: `flatSeaConfig` in scripts/_price-foil-300.ts). */
export function flatSeaFactoryConfig(
  seaRate = 500,
  overrides: Partial<FactoryPricingConfig> = {}
): FactoryPricingConfig {
  const base = structuredClone(DEFAULT_FACTORY_CONFIG);
  return {
    ...base,
    activeSeaCarrierId: undefined,
    seaCarriers: [],
    shippingOptions: base.shippingOptions.map((s) =>
      s.type === "sea" ? { ...s, seaRate } : s
    ),
    ...overrides,
  };
}

export const TIERED_FACTORY_CONFIG: FactoryPricingConfig = tieredFactoryConfig();
export const FLAT_SEA_FACTORY_CONFIG: FactoryPricingConfig = flatSeaFactoryConfig();

/** Ids as they appear in the factory config (NOT the calculator's s1/s2). */
export const SEA_ID = "sea-standard";
export const AIR_ID = "air-express";

/** The 2026-09-07 foil order: ¥1.27 · 5,000 · real carton · plates ¥530×2 · molds ¥1,000. */
export const FOIL_CARTON = { qty: 200, weightKg: 17, lengthCm: 48, widthCm: 41, heightCm: 45 };
export const FOIL_ORDER: FactoryPricingInput = {
  factoryUnitCostCny: 1.27,
  quantity: 5000,
  shippingOptionId: SEA_ID,
  cartonSpec: FOIL_CARTON,
  platePerColorCny: 530,
  logoColors: 2,
  moldsCostCny: 1000,
};

/** Air-volumetric fixtures ported from scripts/_verify-air-volumetric.ts. */
export const AIR_QTY = 100;
export const AIR_USD_TO_ILS = 3.6;
export const AIR_RATES = { thresholdKg: 100, rateBelowThreshold: 13, rateAboveThreshold: 8.5 };
/** 60×60×60 cm = 0.216 m³/carton, 5 kg → volume dominates. */
export const BULKY_CARTON = { qty: 10, weightKg: 5, lengthCm: 60, widthCm: 60, heightCm: 60 };
/** 30×30×30 cm = 0.027 m³/carton, 25 kg → physical weight dominates. */
export const DENSE_CARTON = { qty: 10, weightKg: 25, lengthCm: 30, widthCm: 30, heightCm: 30 };

/** Minimal factory config for the air tests: air tiers + flat sea, no carrier. */
export const AIR_TEST_FACTORY_CONFIG: FactoryPricingConfig = {
  shippingOptions: [
    { id: "s-air", name: "Air", type: "air", enabled: true, airRates: AIR_RATES },
    { id: "s-sea", name: "Sea", type: "sea", enabled: true, seaRate: 500 },
  ],
  usdToIls: AIR_USD_TO_ILS,
  usdToCny: 7.2,
  defaultProfitMargin: 30,
  currency: "ILS",
};

/** Minimal calculator AppConfig for the air tests (one product, one tier). */
export function airTestAppConfig(carton: typeof BULKY_CARTON): AppConfig {
  const variant = {
    prices: { "100": 1.0 },
    carton: {
      qty: carton.qty,
      weight: carton.weightKg,
      length: carton.lengthCm,
      width: carton.widthCm,
      height: carton.heightCm,
    },
  };
  return {
    products: [
      {
        id: "p1",
        dimensions: "30*40",
        description: "test",
        withHandles: variant,
        withoutHandles: variant,
        sortOrder: 0,
      },
    ],
    colorAddons: [],
    quantityTiers: [{ id: "q0", quantity: 100, label: "100", sortOrder: 0 }],
    shippingOptions: [
      { id: "s-air", name: "Air", description: "", deliveryDays: 7, type: "air", enabled: true, airRates: AIR_RATES },
      { id: "s-sea", name: "Sea", description: "", deliveryDays: 60, type: "sea", enabled: true, seaRate: 500 },
    ],
    features: [],
    exchangeRates: { usdToIls: AIR_USD_TO_ILS, usdToCny: 7.2 },
    adminSettings: { globalProfitMargin: 30 },
  };
}

/** Deep copy of the catalog engine config (products, tiers, s1/s2, YEADIM). */
export function appConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...structuredClone(DEFAULT_CONFIG), ...overrides };
}

/** Same catalog, but the legacy flat sea rule (no carrier). */
export function flatSeaAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = structuredClone(DEFAULT_CONFIG);
  return { ...base, seaCarriers: [], activeSeaCarrierId: undefined, ...overrides };
}

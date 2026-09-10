/**
 * Default factory-pricing config — PURE module (no db, no env).
 *
 * Lives apart from `config.ts` on purpose: `config.ts` imports `@/lib/db`,
 * which throws at import time without DATABASE_URL, so anything that only
 * needs the default shape (tests, fixtures, client-safe display) imports it
 * from here. `config.ts` re-exports it, so existing callers are unchanged.
 */

import type { FactoryPricingConfig } from "./types";
import { DEFAULT_PAYMENT_PLAN_ID, VAT_PCT } from "./payment-terms";
import { YEADIM_CARRIER, DEFAULT_ASSUMED_SHIPMENT_CBM } from "./sea-carriers";

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
  negotiationBufferAgorot: 0,
  estimatorShippingBufferPct: 15,
  estimatorShippingBufferLamPct: 10,
  laminationPlateFeePerColorCny: 500,
  currency: "ILS",
  paymentTerms: { defaultPlanId: DEFAULT_PAYMENT_PLAN_ID, vatPct: VAT_PCT },
};

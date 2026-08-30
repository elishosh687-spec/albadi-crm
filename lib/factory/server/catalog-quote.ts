/**
 * Price a CATALOG product server-side, with an optional margin override.
 *
 * The estimator already had a reusable server helper (`estimateQuoteForSpec`);
 * the catalog path only existed inside app/api/factory/quote-preview/route.ts,
 * so anything else that needed a catalog price had to make an HTTP round trip
 * to our own route or re-derive the pricing. Re-deriving is exactly how the
 * numbers on two screens start disagreeing, so this lifts the route's own
 * config builder into one place.
 *
 * `buildCatalogConfig` is the same function the route used, unchanged — the
 * route now imports it rather than keeping a private copy.
 */
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { calculateQuote } from "@/lib/factory/calculator/engine";
import type {
  AppConfig,
  Product,
  QuoteFormData,
  QuoteResult,
} from "@/lib/factory/calculator/types";
import { getFactoryConfig } from "@/lib/factory/config";

export function buildCatalogConfig(
  dbConfig: Awaited<ReturnType<typeof getFactoryConfig>>,
  marginOverride: number | null,
  extraProducts: Product[] = [],
): AppConfig {
  const margins =
    marginOverride !== null
      ? {
          "1000": marginOverride,
          "3000": marginOverride,
          "5000": marginOverride,
          "10000": marginOverride,
        }
      : (dbConfig.profitMarginByQuantity ?? {});

  return {
    ...DEFAULT_CONFIG,
    products: [...DEFAULT_CONFIG.products, ...extraProducts],
    seaCarriers: dbConfig.seaCarriers ?? DEFAULT_CONFIG.seaCarriers,
    activeSeaCarrierId:
      dbConfig.activeSeaCarrierId ?? DEFAULT_CONFIG.activeSeaCarrierId,
    assumedShipmentCbm:
      dbConfig.assumedShipmentCbm ?? DEFAULT_CONFIG.assumedShipmentCbm,
    exchangeRates: { usdToIls: dbConfig.usdToIls, usdToCny: dbConfig.usdToCny },
    adminSettings: {
      globalProfitMargin: marginOverride ?? dbConfig.defaultProfitMargin,
      profitMarginByQuantity: margins,
      negotiationBufferAgorot: dbConfig.negotiationBufferAgorot,
      laminationPlateFeePerColorCny: dbConfig.laminationPlateFeePerColorCny,
    },
    shippingOptions: DEFAULT_CONFIG.shippingOptions.map((s) => {
      const dbOpt = dbConfig.shippingOptions.find(
        (d) => d.type === s.type && d.enabled,
      );
      if (!dbOpt) return s;
      return {
        ...s,
        enabled: dbOpt.enabled,
        seaRate: dbOpt.seaRate ?? s.seaRate,
        airRates: dbOpt.airRates ?? s.airRates,
      };
    }),
  };
}

export interface CatalogQuoteInput {
  productId: string;
  quantity: number;
  logoColors?: number;
  hasHandles?: boolean;
  hasLamination?: boolean;
  shippingOptionId: string;
  marginOverride?: number | null;
  moldsCostCny?: number;
}

/** null when the engine can't price it (unknown product / no tier). */
export async function catalogQuoteForProduct(
  input: CatalogQuoteInput,
): Promise<QuoteResult | null> {
  const dbConfig = await getFactoryConfig({ fresh: true });
  const cfg = buildCatalogConfig(dbConfig, input.marginOverride ?? null);
  const form: QuoteFormData = {
    productId: input.productId,
    // quantityOverride drives the real quantity; the tier id is only a lookup
    // shortcut the caller doesn't have here.
    quantityTierId: "",
    quantityOverride: input.quantity,
    hasHandles: input.hasHandles ?? true,
    logoColors: input.logoColors ?? 1,
    shippingOptionId: input.shippingOptionId,
    selectedFeatureIds: input.hasLamination ? ["f1"] : [],
    moldsCostCny: input.moldsCostCny ?? 0,
  };
  return calculateQuote(form, cfg);
}

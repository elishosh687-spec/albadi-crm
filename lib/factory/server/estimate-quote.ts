/**
 * Price an arbitrary (off-catalog) bag — the shared path.
 *
 * Extracted from app/api/factory/estimate/route.ts so the WhatsApp bot and the
 * operator calculator price a custom size through EXACTLY the same code. The
 * wiring below is full of don't-double-count subtleties (handles and colours
 * are already baked into the estimator's per-unit cost, plate fee rides the
 * lamination pass-through), and a second copy of it would drift silently — the
 * kind of divergence that ends with the customer's quote and the internal
 * numbers disagreeing.
 */
import { calculateQuote } from "../calculator/engine";
import { DEFAULT_CONFIG } from "../calculator/constants";
import { getFactoryConfig } from "../config";
import { estimateFactoryCny, type EstimateResult, type EstimateSpec } from "../estimator";
import type { AppConfig, Product, QuoteFormData, QuoteResult } from "../calculator/types";
import type { FactoryPricingConfig } from "../types";

export interface EstimateQuoteInput {
  spec: EstimateSpec;
  /** Shipping option id from the factory config (e.g. "sea-standard"). */
  shippingOptionId: string;
  marginOverride?: number | null;
  moldsCostCny?: number;
}

export interface EstimateQuoteOutput {
  ok: boolean;
  /** Why we can't price it — caller should fall back to the human/factory path. */
  refused?: string;
  estimate: EstimateResult;
  result?: QuoteResult;
  altResult?: QuoteResult | null;
}

function buildConfig(
  dbConfig: FactoryPricingConfig,
  custom: Product,
  marginOverride: number | null
): AppConfig {
  // A margin override flattens every tier to the same value for this
  // calculation; null falls back to the system tier margins.
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
    products: [...DEFAULT_CONFIG.products, custom],
    seaCarriers: dbConfig.seaCarriers ?? DEFAULT_CONFIG.seaCarriers,
    activeSeaCarrierId: dbConfig.activeSeaCarrierId ?? DEFAULT_CONFIG.activeSeaCarrierId,
    assumedShipmentCbm: dbConfig.assumedShipmentCbm ?? DEFAULT_CONFIG.assumedShipmentCbm,
    exchangeRates: { usdToIls: dbConfig.usdToIls, usdToCny: dbConfig.usdToCny },
    adminSettings: {
      globalProfitMargin: marginOverride ?? dbConfig.defaultProfitMargin,
      profitMarginByQuantity: margins,
      negotiationBufferAgorot: dbConfig.negotiationBufferAgorot,
      laminationPlateFeePerColorCny: dbConfig.laminationPlateFeePerColorCny,
    },
    // Keep the calculator's own shipping option shape (it carries description +
    // deliveryDays); only the enabled flag and rates come from the DB.
    shippingOptions: DEFAULT_CONFIG.shippingOptions.map((s) => {
      const dbOpt = dbConfig.shippingOptions.find((d) => d.type === s.type && d.enabled);
      return dbOpt
        ? {
            ...s,
            enabled: dbOpt.enabled,
            seaRate: dbOpt.seaRate ?? s.seaRate,
            airRates: dbOpt.airRates ?? s.airRates,
          }
        : s;
    }),
  };
}

export async function estimateQuoteForSpec(
  input: EstimateQuoteInput
): Promise<EstimateQuoteOutput> {
  const { spec } = input;
  const est = await estimateFactoryCny(spec);
  if (!est.ok) {
    return { ok: false, refused: est.refused ?? "לא ניתן לאמוד", estimate: est };
  }

  const dbConfig = await getFactoryConfig({ fresh: true });
  const cny = est.factoryUnitCostCny!;
  const c = est.carton ?? {
    qty: 250,
    weightKg: 5,
    lengthCm: 40,
    widthCm: 30,
    heightCm: 40,
  };
  // The estimator returns ONE per-unit cost; the engine wants a tier table, so
  // the same number fills every tier and quantityOverride drives the real qty.
  const flat = { "1000": cny, "3000": cny, "5000": cny, "10000": cny };
  const lamFlat: Record<string, number> = spec.hasLamination ? { ...flat } : {};

  const carton = {
    qty: c.qty,
    weight: c.weightKg,
    length: c.lengthCm,
    width: c.widthCm,
    height: c.heightCm,
  };
  const custom: Product = {
    id: "estimate",
    dimensions: `H${spec.heightCm}${spec.depthCm ? `*D${spec.depthCm}` : ""}*W${spec.widthCm}`,
    description: `אומדן ${est.factoryName}`,
    sortOrder: 9999,
    laminationColorPlateFee: est.platePerColorCny ?? 0,
    withHandles: { prices: flat, carton, laminationPrices: lamFlat },
    withoutHandles: { prices: flat, carton, laminationPrices: lamFlat },
  };

  const cfg = buildConfig(dbConfig, custom, input.marginOverride ?? null);
  const form: QuoteFormData = {
    productId: "estimate",
    quantityTierId: "",
    quantityOverride: spec.quantity,
    // hasHandles:false and logoColors:1 are deliberate — both are already
    // inside factoryUnitCostCny. Passing the real values would charge for them
    // twice. They're restored on the RESULT below so the printed spec line is
    // still what the customer ordered.
    hasHandles: false,
    logoColors: spec.hasLamination ? spec.logoColors : 1,
    shippingOptionId: input.shippingOptionId,
    selectedFeatureIds: spec.hasLamination ? ["f1"] : [],
    moldsCostCny: input.moldsCostCny ?? 0,
  };

  const result = calculateQuote(form, cfg);
  if (!result) {
    return {
      ok: false,
      refused: "החישוב נכשל",
      estimate: { ...est, ok: false, refused: "החישוב נכשל — שלח למפעל" },
    };
  }

  const currentType = result.shippingOption?.type;
  const alt =
    currentType === "air"
      ? cfg.shippingOptions.find((s) => s.enabled && s.type === "sea")
      : currentType === "sea"
        ? cfg.shippingOptions.find((s) => s.enabled && s.type === "air")
        : null;
  const altResult = alt ? calculateQuote({ ...form, shippingOptionId: alt.id }, cfg) : null;

  // Display-only restore (see the form comment above) — pricing is untouched.
  result.hasHandles = spec.hasHandles;
  result.logoColors = spec.logoColors;
  if (altResult) {
    altResult.hasHandles = spec.hasHandles;
    altResult.logoColors = spec.logoColors;
  }

  return { ok: true, estimate: est, result, altResult };
}

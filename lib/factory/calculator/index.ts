/**
 * Public API for the ported quote calculator.
 *
 * Two entry points:
 *   - computeQuoteBreakdown(spec) — for the customer PDF. Takes physical spec
 *     (w/h/d, qty, handles, colors, lamination, shipping), finds the matching
 *     14-product entry, returns per-component ILS selling prices.
 *   - calculateQuoteByCodes({ productId, ... }) — for the bot. Takes the
 *     option codes the questionnaire collects directly (p1..p13, q0..q3,
 *     s1/s2) and returns the full QuoteResult plus the alternative shipping
 *     option (sea ↔ air) for the customer message.
 */

import { calculateQuote } from "./engine";
import { DEFAULT_CONFIG } from "./constants";
import type { AppConfig, QuoteResult, QuoteFormData } from "./types";
import { getFactoryConfig } from "../config";

export { DEFAULT_CONFIG };
export type { QuoteResult, QuoteFormData };

export interface QuoteBreakdown {
  productId: string;
  dimensions: string;
  quantity: number;
  baseBagPerUnit: number; // ILS, with margin
  handlesPerUnit: number;
  colorAddonPerUnit: number;
  laminationAddonPerUnit: number;
  plateFeePerUnit: number;
  shippingPerUnit: number; // pass-through, no margin
  shippingOptionName: string | null;
  totalPerUnit: number;
  totalOrder: number;
  logoColors: number;
  hasHandles: boolean;
  hasLamination: boolean;
  profitMargin: number; // %
}

/**
 * Canonical factory dimension format: `H{height}*D{depth}*W{width}` (in cm).
 * Depth omitted when zero (flat bags). Letter prefixes make the dimension
 * order unambiguous to customers, Eli, and the factory.
 */
function dimensionsString(w: number, d: number, h: number): string {
  return d > 0 ? `H${h}*D${d}*W${w}` : `H${h}*W${w}`;
}

function findProductIdByDims(w: number, d: number, h: number): string | null {
  const candidates = [
    dimensionsString(w, d, h),
    // also try W↔H swap (some specs are inverted)
    dimensionsString(h, d, w),
  ];
  for (const dims of candidates) {
    const hit = DEFAULT_CONFIG.products.find((p) => p.dimensions === dims);
    if (hit) return hit.id;
  }
  return null;
}

function findQuantityTierId(qty: number): string | null {
  // exact match first
  const exact = DEFAULT_CONFIG.quantityTiers.find((t) => t.quantity === qty);
  if (exact) return exact.id;
  // else: closest tier ≤ qty (engine's findClosestPrice mirrors this)
  const sorted = [...DEFAULT_CONFIG.quantityTiers].sort(
    (a, b) => a.quantity - b.quantity
  );
  let best = sorted[0];
  for (const t of sorted) {
    if (t.quantity <= qty) best = t;
  }
  return best?.id ?? null;
}

export function computeQuoteBreakdown(spec: {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  quantity: number;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string | null;
}): QuoteBreakdown | null {
  const productId = findProductIdByDims(
    spec.widthCm,
    spec.depthCm,
    spec.heightCm
  );
  if (!productId) return null;

  const tierId = findQuantityTierId(spec.quantity);

  const form: QuoteFormData = {
    productId,
    quantityTierId: tierId,
    quantityOverride: tierId ? null : spec.quantity,
    hasHandles: spec.hasHandles,
    logoColors: spec.logoColors,
    shippingOptionId: spec.shippingOptionId,
    selectedFeatureIds: spec.hasLamination ? ["f1"] : [],
  };

  const result = calculateQuote(form, DEFAULT_CONFIG);
  if (!result) return null;

  // Convert each CNY component → ILS selling (with margin); shipping
  // stays pass-through.
  const { usdToCny, usdToIls } = DEFAULT_CONFIG.exchangeRates;
  const margin = result.profitMargin;
  // MARGIN-on-price semantics: selling = cost / (1 - margin). Same as engine.ts.
  const marginFrac = Math.min(Math.max(margin, 0), 99.9) / 100;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const toSellingIls = (cny: number) =>
    r2(((cny / usdToCny) * usdToIls) / (1 - marginFrac));

  let baseBagPerUnit = toSellingIls(result.baseBagCny);
  const handlesPerUnit = toSellingIls(result.handlesAddonCny);
  const laminationAddonPerUnit = toSellingIls(result.laminationAddonCny);
  const plateFeePerUnit = toSellingIls(result.plateFeeCny);
  const colorAddonPerUnit = toSellingIls(result.logoAddonCny);
  const shippingPerUnitRaw = r2(result.shippingPerUnitUsd * usdToIls);

  // bag-quote-app default UX: shipping is *baked into* the base bag price
  // (no separate row) so the customer sees one all-in product price.
  // Matches the screenshot the user requested. To break it out into its own
  // row, flip this flag to true.
  const showShippingAsSeparateRow = false;
  let shippingPerUnit = 0;
  if (showShippingAsSeparateRow) {
    shippingPerUnit = shippingPerUnitRaw;
  } else {
    baseBagPerUnit = r2(baseBagPerUnit + shippingPerUnitRaw);
  }

  return {
    productId,
    dimensions: result.product?.dimensions ?? "",
    quantity: result.quantity,
    baseBagPerUnit,
    handlesPerUnit,
    colorAddonPerUnit,
    laminationAddonPerUnit,
    plateFeePerUnit,
    shippingPerUnit,
    shippingOptionName: result.shippingOption?.name ?? null,
    totalPerUnit: result.sellingPricePerUnitIls,
    totalOrder: result.totalOrderPriceIls,
    logoColors: result.logoColors,
    hasHandles: result.hasHandles,
    hasLamination: spec.hasLamination,
    profitMargin: margin,
  };
}

export interface CalculateByCodesInput {
  productId: string; // p1..p13
  quantityTierId: string; // q0..q3 (or null + quantityOverride)
  quantityOverride?: number | null;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string; // s1 | s2
}

export interface CalculateByCodesOutput {
  result: QuoteResult;
  altResult: QuoteResult | null; // alternative shipping (sea ↔ air)
}

/**
 * Merge admin-editable values from the DB config (`app_config.factory_pricing`)
 * into the hardcoded catalog `DEFAULT_CONFIG`. Catalog data (products, qty
 * tiers, color addons, features) stays in code — it's keyed to the factory's
 * price sheet. Admin tweakables (margin matrix, USD/CNY/ILS rates, shipping
 * rates) come from the DB so the Settings page actually drives the bot.
 *
 * Shipping options are matched by `type` (air ↔ s1, sea ↔ s2) so the
 * questionnaire IDs remain stable while rates/threshold can be tuned live.
 */
async function buildMergedConfig(): Promise<AppConfig> {
  const dbConfig = await getFactoryConfig();
  const matrix = dbConfig.profitMarginByQuantity ?? {};
  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    exchangeRates: {
      usdToIls: dbConfig.usdToIls,
      usdToCny: dbConfig.usdToCny,
    },
    adminSettings: {
      globalProfitMargin: dbConfig.defaultProfitMargin,
      profitMarginByQuantity: { ...matrix },
    },
    shippingOptions: DEFAULT_CONFIG.shippingOptions.map((s) => {
      const dbOpt = dbConfig.shippingOptions.find(
        (d) => d.type === s.type && d.enabled
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
  return merged;
}

export async function calculateQuoteByCodes(
  input: CalculateByCodesInput
): Promise<CalculateByCodesOutput | null> {
  const form: QuoteFormData = {
    productId: input.productId,
    quantityTierId: input.quantityTierId,
    quantityOverride: input.quantityOverride ?? null,
    hasHandles: input.hasHandles,
    logoColors: input.logoColors,
    shippingOptionId: input.shippingOptionId,
    selectedFeatureIds: input.hasLamination ? ["f1"] : [],
  };

  const cfg = await buildMergedConfig();

  const result = calculateQuote(form, cfg);
  if (!result) return null;

  const currentType = result.shippingOption?.type;
  const altShipping =
    currentType === "air"
      ? cfg.shippingOptions.find((s) => s.enabled && s.type === "sea")
      : currentType === "sea"
        ? cfg.shippingOptions.find((s) => s.enabled && s.type === "air")
        : null;
  const altResult = altShipping
    ? calculateQuote({ ...form, shippingOptionId: altShipping.id }, cfg)
    : null;

  return { result, altResult };
}

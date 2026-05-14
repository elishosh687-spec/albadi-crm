/**
 * Public API for the ported quote calculator.
 *
 * Two entry points:
 *   - computeQuoteBreakdown(spec) — for the customer PDF. Takes physical spec
 *     (w/h/d, qty, handles, colors, lamination, shipping), finds the matching
 *     14-product entry, returns per-component ILS selling prices.
 *   - calculateQuoteByCodes({ productId, ... }) — for the bot. Takes the
 *     option codes the questionnaire collects directly (p1..p14, q0..q3,
 *     s1/s2) and returns the full QuoteResult plus the alternative shipping
 *     option (sea ↔ air) for the customer message.
 */

import { calculateQuote } from "./engine";
import { DEFAULT_CONFIG } from "./constants";
import type { QuoteResult, QuoteFormData } from "./types";

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

function dimensionsString(w: number, d: number, h: number): string {
  return d > 0 ? `${w}×${d}×${h}` : `${w}×${h}`;
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
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const toSellingIls = (cny: number) =>
    r2((cny / usdToCny) * usdToIls * (1 + margin / 100));

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
  productId: string; // p1..p14
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

export function calculateQuoteByCodes(
  input: CalculateByCodesInput
): CalculateByCodesOutput | null {
  const form: QuoteFormData = {
    productId: input.productId,
    quantityTierId: input.quantityTierId,
    quantityOverride: input.quantityOverride ?? null,
    hasHandles: input.hasHandles,
    logoColors: input.logoColors,
    shippingOptionId: input.shippingOptionId,
    selectedFeatureIds: input.hasLamination ? ["f1"] : [],
  };

  const result = calculateQuote(form, DEFAULT_CONFIG);
  if (!result) return null;

  const currentType = result.shippingOption?.type;
  const altShipping =
    currentType === "air"
      ? DEFAULT_CONFIG.shippingOptions.find(
          (s) => s.enabled && s.type === "sea"
        )
      : currentType === "sea"
        ? DEFAULT_CONFIG.shippingOptions.find(
            (s) => s.enabled && s.type === "air"
          )
        : null;
  const altResult = altShipping
    ? calculateQuote({ ...form, shippingOptionId: altShipping.id }, DEFAULT_CONFIG)
    : null;

  return { result, altResult };
}

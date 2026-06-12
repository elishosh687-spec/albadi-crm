/**
 * Combined pricing for several products that ship together in ONE shipment.
 *
 * Shipping is a pass-through cost (no margin), and a single shipment is cheaper
 * than shipping each product separately — the sea 1-CBM floor is counted once,
 * and air weight tiers apply to the combined weight. So we recompute shipping
 * on the MERGED volume/weight and pass the saving straight to the customer:
 *   profit is unchanged (it's margin on production), the price just drops.
 *
 * Shared by the FinalizeModal "חישוב משולב" panel and the combined PDF.
 */

import { priceFactoryQuote } from "./pricing";
import type {
  FactoryPricingConfig,
  FactoryPricingResult,
  FactoryProductSpec,
  FactoryResponse,
  ShippingOption,
} from "./types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default profit margin for a quantity, using the per-qty matrix (snap-down). */
function snapMargin(config: FactoryPricingConfig, qty: number): number {
  const m = config.profitMarginByQuantity;
  if (m && Object.keys(m).length > 0) {
    if (m[String(qty)] !== undefined) return m[String(qty)];
    const keys = Object.keys(m)
      .map(Number)
      .sort((a, b) => a - b);
    let best = keys[0];
    for (const k of keys) if (k <= qty) best = k;
    return m[String(best)] ?? config.defaultProfitMargin;
  }
  return config.defaultProfitMargin;
}

/**
 * Pricing for a quote to feed the combined calc. Uses the saved finalPricing
 * when finalized; otherwise prices the factory response on the fly with the
 * default (per-qty) margin, so "received" quotes can be combined before they're
 * individually finalized.
 */
export function priceQuoteForCombine(
  q: {
    productSpec: FactoryProductSpec;
    factoryResponse: FactoryResponse | null;
    finalPricing: FactoryPricingResult | null;
  },
  config: FactoryPricingConfig,
  shippingOptionId: string | null
): FactoryPricingResult | null {
  if (q.finalPricing) return q.finalPricing;
  const resp = q.factoryResponse;
  if (!resp) return null;
  const qty = q.productSpec.quantity;
  return priceFactoryQuote(
    {
      factoryUnitCostCny: resp.unitCostCny,
      quantity: qty,
      shippingOptionId: shippingOptionId || q.productSpec.shippingOptionId || null,
      cartonSpec: {
        qty: resp.cartonQty,
        weightKg: resp.weightKg,
        cbm: resp.cartonCbm,
        lengthCm: resp.cartonLengthCm,
        widthCm: resp.cartonWidthCm,
        heightCm: resp.cartonHeightCm,
      },
      profitMarginOverride: snapMargin(config, qty),
      moldsCostCny: 0,
    },
    config
  );
}

/** Total shipping (ILS) for a single shipment of the given CBM + weight. */
export function combinedShippingIls(
  totalCbm: number,
  totalWeightKg: number,
  opt: ShippingOption | null | undefined,
  usdToIls: number
): number {
  if (!opt) return 0;
  let usd = 0;
  if (opt.type === "sea" && opt.seaRate && opt.seaRate > 0) {
    usd = Math.max(totalCbm, 1) * opt.seaRate; // 1-CBM floor counted ONCE
  } else if (opt.type === "air" && opt.airRates) {
    const r = opt.airRates;
    const rate =
      totalWeightKg <= r.thresholdKg ? r.rateBelowThreshold : r.rateAboveThreshold;
    usd = totalWeightKg * rate;
  }
  return r2(usd * usdToIls);
}

/** Per-product fields needed from each quote's pricing (FactoryPricingResult). */
export interface CombinedItemInput {
  totalCost: number; // production only (ILS), excludes shipping
  totalProfit: number;
  totalSellingPrice: number; // production + profit + its own shipping
  totalShipping: number;
  totalCbm: number;
  totalWeightKg: number;
}

export interface CombinedPricingResult {
  count: number;
  combinedCbm: number;
  combinedWeightKg: number;
  combinedShipping: number; // recomputed, one shipment
  separateShipping: number; // sum of each product's own shipping
  shippingSaving: number; // separate − combined (≥ 0)
  totalProduction: number; // sum of production costs
  totalProfit: number; // unchanged by combining
  productPriceTotal: number; // production + profit (before shipping)
  grandTotal: number; // productPriceTotal + combinedShipping
  separateGrandTotal: number; // sum of each product's totalSellingPrice
  overallMarginPct: number; // profit ÷ product price (margin-on-price)
}

export function computeCombined(
  items: CombinedItemInput[],
  opt: ShippingOption | null | undefined,
  usdToIls: number
): CombinedPricingResult {
  const sum = (f: (i: CombinedItemInput) => number) =>
    items.reduce((s, i) => s + (f(i) || 0), 0);

  const combinedCbm = r2(sum((i) => i.totalCbm));
  const combinedWeightKg = r2(sum((i) => i.totalWeightKg));
  const combinedShipping = combinedShippingIls(
    combinedCbm,
    combinedWeightKg,
    opt,
    usdToIls
  );
  const separateShipping = r2(sum((i) => i.totalShipping));
  const totalProduction = r2(sum((i) => i.totalCost));
  const totalProfit = r2(sum((i) => i.totalProfit));
  const productPriceTotal = r2(totalProduction + totalProfit);
  const grandTotal = r2(productPriceTotal + combinedShipping);

  return {
    count: items.length,
    combinedCbm,
    combinedWeightKg,
    combinedShipping,
    separateShipping,
    shippingSaving: r2(separateShipping - combinedShipping),
    totalProduction,
    totalProfit,
    productPriceTotal,
    grandTotal,
    separateGrandTotal: r2(sum((i) => i.totalSellingPrice)),
    overallMarginPct:
      productPriceTotal > 0 ? Math.round((totalProfit / productPriceTotal) * 1000) / 10 : 0,
  };
}

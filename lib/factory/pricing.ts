/**
 * Factory-priced quote calculator (ported from bag-quote-app/lib/factory-pricing.ts).
 *
 * Inputs: factory's unit cost in CNY + carton spec + shipping option + quantity.
 * Outputs: per-unit cost, shipping, profit, selling price (all in ILS).
 *
 * Key convention (matches the customer-facing rough estimator):
 *   shipping is a **pass-through** cost — margin applies only to production.
 *   selling = (production_cost) × (1 + margin) + shipping_cost
 *   profit  = selling - cost_total = selling - (production + shipping)
 */

import type {
  FactoryPricingConfig,
  FactoryPricingInput,
  FactoryPricingResult,
  ShippingOption,
} from "./types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeShippingPerUnitUsd(
  shipping: ShippingOption | null,
  totalWeightKg: number,
  totalCbm: number,
  quantity: number
): number {
  if (!shipping || quantity <= 0) return 0;
  if (shipping.type === "air" && shipping.airRates) {
    const rates = shipping.airRates;
    const rate =
      totalWeightKg <= rates.thresholdKg
        ? rates.rateBelowThreshold
        : rates.rateAboveThreshold;
    return (totalWeightKg * rate) / quantity;
  }
  if (shipping.type === "sea" && shipping.seaRate && shipping.seaRate > 0) {
    return (Math.max(totalCbm, 1) * shipping.seaRate) / quantity;
  }
  return 0;
}

export function priceFactoryQuote(
  input: FactoryPricingInput,
  config: FactoryPricingConfig
): FactoryPricingResult {
  const usdToTarget = config.usdToIls;
  const cnyToUsd = 1 / (config.usdToCny || 1);

  const quantity = Math.max(1, Math.floor(input.quantity));
  const carton = input.cartonSpec ?? {};
  const cartonQty = carton.qty && carton.qty > 0 ? carton.qty : 0;
  const totalCartons = cartonQty > 0 ? Math.ceil(quantity / cartonQty) : 0;
  const totalWeightKg = (carton.weightKg ?? 0) * totalCartons;

  // CBM: prefer factory-provided cbm; otherwise derive from L×W×H (cm) → m³
  let perCartonCbm = carton.cbm;
  if (
    (perCartonCbm === undefined || perCartonCbm === 0) &&
    carton.lengthCm &&
    carton.widthCm &&
    carton.heightCm
  ) {
    perCartonCbm = (carton.lengthCm * carton.widthCm * carton.heightCm) / 1_000_000;
  }
  const totalCbm = (perCartonCbm ?? 0) * totalCartons;

  const shipping = input.shippingOptionId
    ? config.shippingOptions.find((s) => s.id === input.shippingOptionId) ?? null
    : null;

  const unitCostUsd = input.factoryUnitCostCny * cnyToUsd;
  const unitShippingUsd = computeShippingPerUnitUsd(
    shipping,
    totalWeightKg,
    totalCbm,
    quantity
  );

  const unitCost = unitCostUsd * usdToTarget;
  const unitShipping = unitShippingUsd * usdToTarget;

  const marginPct =
    input.profitMarginOverride !== undefined
      ? input.profitMarginOverride
      : config.defaultProfitMargin;

  // Pass-through shipping (no margin on shipping).
  // Compute selling price exact first, round display only — profit must NOT be derived
  // from the rounded selling price or a per-unit rounding error compounds over quantity
  // (e.g. a 0.01 ILS/unit rounding delta × 10 000 units = 100 ILS difference between
  // sea and air for identical factory cost).
  const unitSellingPriceExact = unitCost * (1 + marginPct / 100) + unitShipping;
  const unitSellingPrice = r2(unitSellingPriceExact);
  const unitProfit = r2(unitCost * (marginPct / 100));

  const totalCost = r2(unitCost * quantity);
  const totalShipping = r2(unitShipping * quantity);
  const totalProfit = r2(unitCost * (marginPct / 100) * quantity);
  const totalSellingPrice = r2(unitSellingPriceExact * quantity);

  return {
    quantity,
    currency: "ILS",
    unitCost: r2(unitCost),
    unitShipping: r2(unitShipping),
    unitProfit,
    unitSellingPrice,
    totalCost,
    totalShipping,
    totalProfit,
    totalSellingPrice,
    totalCartons,
    totalWeightKg: r2(totalWeightKg),
    totalCbm: r2(totalCbm),
    profitMarginPct: marginPct,
    shippingOptionId: shipping?.id ?? null,
    shippingOptionName: shipping?.name ?? null,
  };
}

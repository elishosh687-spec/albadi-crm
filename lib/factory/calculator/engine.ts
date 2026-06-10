/**
 * Port of bag-quote-app/lib/pricing-engine.ts `calculateQuote`.
 * Pure function — given form data + config, returns the structured quote
 * result with CNY/USD/ILS breakdowns. ILS-only (no EUR/GBP/USD currency
 * switching — albadi-crm is ILS).
 */

import type {
  AppConfig,
  ProductVariant,
  QuoteFormData,
  QuoteResult,
} from "./types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function findClosestPrice(
  prices: Record<string, number>,
  quantityKey: string
): number {
  if (prices[quantityKey] !== undefined) return prices[quantityKey];
  const qty = parseInt(quantityKey, 10);
  const keys = Object.keys(prices).map(Number).sort((a, b) => a - b);
  let bestKey = keys[0];
  for (const k of keys) {
    if (k <= qty) bestKey = k;
  }
  return prices[String(bestKey)] ?? 0;
}

export function calculateQuote(
  formData: QuoteFormData,
  config: AppConfig
): QuoteResult | null {
  const {
    products,
    colorAddons,
    quantityTiers,
    shippingOptions,
    features,
    exchangeRates,
    adminSettings,
  } = config;
  const targetRate = exchangeRates.usdToIls;

  const product = products.find((p) => p.id === formData.productId) ?? null;
  if (!product) return null;

  const tier = quantityTiers.find((t) => t.id === formData.quantityTierId);
  const effectiveQuantity = formData.quantityOverride ?? tier?.quantity;
  if (!effectiveQuantity) return null;
  const quantity = effectiveQuantity;
  const quantityKey = String(quantity);

  const hasHandles = formData.hasHandles ?? false;
  const variant: ProductVariant = hasHandles
    ? product.withHandles
    : product.withoutHandles;

  // Step 1: Base price in CNY
  const basePriceCny = findClosestPrice(variant.prices, quantityKey);

  // Step 2: Lamination or color addon
  const hasLamination = formData.selectedFeatureIds.includes("f1");

  const effectiveBaseCny = hasLamination
    ? findClosestPrice(variant.laminationPrices ?? {}, quantityKey)
    : basePriceCny;

  // Lamination: plate fee per print color, not logo addon
  const laminationColorCostCny = hasLamination
    ? ((product.laminationColorPlateFee ?? 0) * formData.logoColors) / quantity
    : 0;

  // Color addon per unit CNY (regular bags only — logo colors)
  const colorAddon = hasLamination
    ? null
    : colorAddons.find((c) => c.colors === formData.logoColors);
  const colorAddonCny = colorAddon
    ? findClosestPrice(colorAddon.pricesByQuantity, quantityKey)
    : 0;

  // Step 3: Unit production cost — includes amortized one-time mold/tooling fee
  const moldsTotalCny = Math.max(formData.moldsCostCny ?? 0, 0);
  const moldsPerUnitCny = moldsTotalCny > 0 ? moldsTotalCny / quantity : 0;
  const unitProductionCny =
    effectiveBaseCny + colorAddonCny + laminationColorCostCny + moldsPerUnitCny;
  const unitProductionUsd = unitProductionCny / exchangeRates.usdToCny;

  // Step 4: Logistics
  const carton = variant.carton;
  const totalCartons = Math.ceil(quantity / carton.qty);
  const totalWeightKg = totalCartons * carton.weight;
  const cbmPerCarton = (carton.length * carton.width * carton.height) / 1_000_000;
  const totalCbm = totalCartons * cbmPerCarton;

  // Step 5: Shipping cost
  const shippingOption =
    shippingOptions.find((s) => s.id === formData.shippingOptionId) ?? null;
  let shippingPerUnitUsd = 0;
  if (shippingOption) {
    if (shippingOption.type === "air" && shippingOption.airRates) {
      const rates = shippingOption.airRates;
      const rate =
        totalWeightKg <= rates.thresholdKg
          ? rates.rateBelowThreshold
          : rates.rateAboveThreshold;
      shippingPerUnitUsd = (totalWeightKg * rate) / quantity;
    } else if (
      shippingOption.type === "sea" &&
      shippingOption.seaRate &&
      shippingOption.seaRate > 0
    ) {
      shippingPerUnitUsd = (Math.max(totalCbm, 1) * shippingOption.seaRate) / quantity;
    }
  }

  // Step 6: Final unit cost
  const finalUnitCostUsd = unitProductionUsd + shippingPerUnitUsd;
  const finalUnitCostIls = finalUnitCostUsd * targetRate;

  // Step 7: Features
  const selectedFeatures = features.filter(
    (f) => formData.selectedFeatureIds.includes(f.id) && f.enabled
  );
  const featuresTotalPerUnitIls = selectedFeatures.reduce(
    (sum, f) => sum + f.sellingPrice,
    0
  );

  // Step 8: Total cost per unit
  const totalCostPerUnitIls = finalUnitCostIls + featuresTotalPerUnitIls;

  // Step 9: Selling price with profit margin.
  // Snap-down on the margin matrix so a custom qty (e.g. 2500) inherits the
  // 1000-tier margin — matching how prices snap to the lower tier.
  const marginMatrix = adminSettings.profitMarginByQuantity;
  const profitMargin =
    marginMatrix && Object.keys(marginMatrix).length > 0
      ? findClosestPrice(marginMatrix, quantityKey)
      : adminSettings.globalProfitMargin;
  const shippingPerUnitIls = shippingPerUnitUsd * targetRate;
  const marginableBaseIls = totalCostPerUnitIls - shippingPerUnitIls;
  // profitMargin is MARGIN-on-price (profit ÷ product price), not markup-on-cost.
  // product price = cost / (1 - margin); shipping is added after, pass-through.
  // Clamp to <100% so a misconfigured value can never divide-by-zero / go negative.
  const marginFrac = Math.min(Math.max(profitMargin, 0), 99.9) / 100;
  // Keep exact (unrounded) for profit and total-order calculations so that
  // changing shipping method does not shift profit via rounding boundaries.
  const sellingPricePerUnitIlsExact =
    marginableBaseIls / (1 - marginFrac) + shippingPerUnitIls;
  const sellingPricePerUnitIls = r2(sellingPricePerUnitIlsExact);
  const totalOrderPriceIls = r2(sellingPricePerUnitIlsExact * quantity);

  // Step 10: Profit — derived from exact selling price so profit = factory × margin
  const profitPerUnitIls = r2(sellingPricePerUnitIlsExact - totalCostPerUnitIls);
  const totalProfitIls = r2(profitPerUnitIls * quantity);

  // Breakdown for invoice
  const baseBagCny = findClosestPrice(product.withoutHandles.prices, quantityKey);
  const handlesAddonCny = hasHandles
    ? hasLamination
      ? findClosestPrice(product.withHandles.laminationPrices ?? {}, quantityKey) -
        findClosestPrice(product.withoutHandles.laminationPrices ?? {}, quantityKey)
      : findClosestPrice(product.withHandles.prices, quantityKey) -
        findClosestPrice(product.withoutHandles.prices, quantityKey)
    : 0;
  const laminationAddonCny = hasLamination
    ? findClosestPrice(variant.laminationPrices ?? {}, quantityKey) -
      findClosestPrice(variant.prices, quantityKey)
    : 0;
  const logoAddonCny = hasLamination ? 0 : colorAddonCny;
  const plateFeeCny = hasLamination ? laminationColorCostCny : 0;

  return {
    product,
    quantity,
    hasHandles,
    logoColors: formData.logoColors,
    shippingOption,
    selectedFeatures,
    basePriceCny: r2(effectiveBaseCny),
    colorAddonCny: r2(colorAddonCny + laminationColorCostCny),
    baseBagCny: r2(baseBagCny),
    handlesAddonCny: r2(handlesAddonCny),
    laminationAddonCny: r2(laminationAddonCny),
    logoAddonCny: r2(logoAddonCny),
    plateFeeCny: r2(plateFeeCny),
    moldsTotalCny: r2(moldsTotalCny),
    moldsPerUnitCny: r3(moldsPerUnitCny),
    unitProductionCny: r2(unitProductionCny),
    unitProductionUsd: r2(unitProductionUsd),
    totalCartons,
    totalWeightKg: r2(totalWeightKg),
    totalCbm: r3(totalCbm),
    shippingPerUnitUsd: r2(shippingPerUnitUsd),
    finalUnitCostUsd: r2(finalUnitCostUsd),
    finalUnitCostIls: r2(finalUnitCostIls),
    featuresTotalPerUnitIls: r2(featuresTotalPerUnitIls),
    totalCostPerUnitIls: r2(totalCostPerUnitIls),
    sellingPricePerUnitIls,
    totalOrderPriceIls,
    profitMargin,
    profitPerUnitIls,
    totalProfitIls,
    currency: "ILS",
  };
}

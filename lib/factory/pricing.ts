/**
 * Factory-priced quote calculator (ported from bag-quote-app/lib/factory-pricing.ts).
 *
 * Inputs: factory's unit cost in CNY + carton spec + shipping option + quantity.
 * Outputs: per-unit cost, shipping, profit, selling price (all in ILS).
 *
 * Key convention (UNIFIED with the customer-facing calculator, engine.ts):
 *   **margin-on-price** — the margin is the profit's share of the PRODUCT price
 *   (the price excluding pass-through shipping). 40% means 40% of the product
 *   price is profit — identical to what the calculator slider means.
 *   shipping is a **pass-through** cost — no margin is taken on it.
 *     productPrice = production_cost / (1 - margin)
 *     selling      = productPrice + shipping_cost
 *     profit       = productPrice - production_cost
 *
 * Mold/tooling: a one-time fee. NOT amortized into per-bag price. Customer
 * sees it as its own line ("תבניות (חד-פעמי)") in the PDF. PASS-THROUGH — no
 * margin: we charge the customer the same CNY→ILS cost we paid the factory.
 * Per-unit numbers (unitCost/unitProfit/unitSellingPrice) are bag-only;
 * totalCost/totalProfit/totalSellingPrice are GRAND totals (bags + mold).
 */

import type {
  FactoryPricingConfig,
  FactoryPricingInput,
  FactoryPricingResult,
  ShippingOption,
} from "./types";
import {
  getActiveSeaCarrier,
  seaPerOrderUsd,
  DEFAULT_ASSUMED_SHIPMENT_CBM,
} from "./sea-carriers";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Volumetric (dimensional) weight factor for AIR freight: kg per CBM.
 *  IATA standard air divisor 6000 → 1 m³ = 166.67 kg, rounded to 167.
 *  Used to bill air shipments on chargeable weight = max(actual, cbm × this). */
const VOLUMETRIC_KG_PER_CBM = 167;

function computeShippingPerUnitUsd(
  shipping: ShippingOption | null,
  totalWeightKg: number,
  totalCbm: number,
  quantity: number,
  config: FactoryPricingConfig,
  seaOpts?: { useTrueCost?: boolean }
): number {
  if (!shipping || quantity <= 0) return 0;
  if (shipping.type === "air" && shipping.airRates) {
    const rates = shipping.airRates;
    // Air is billed on CHARGEABLE (volumetric) weight, not physical weight:
    // chargeable = max(actual kg, volumetric kg) where volumetric = cbm × 167
    // (IATA standard, divisor 6000). A bulky/light shipment whose volume
    // outweighs its scale weight is billed by the volume — matching how the
    // forwarder actually charges. Dense cargo (physical > volumetric) is
    // unaffected. The rate tier (thresholdKg) is judged on the chargeable kg.
    const chargeableKg = Math.max(totalWeightKg, totalCbm * VOLUMETRIC_KG_PER_CBM);
    const rate =
      chargeableKg <= rates.thresholdKg
        ? rates.rateBelowThreshold
        : rates.rateAboveThreshold;
    return (chargeableKg * rate) / quantity;
  }
  if (shipping.type === "sea") {
    // Active forwarder profile drives sea pricing. The per-order rule bills
    // small orders at the assumed-volume (default 3 CBM) per-CBM rate; larger
    // orders pay their own true cost. See seaPerOrderUsd.
    const carrier = getActiveSeaCarrier(config);
    if (carrier) {
      const res = seaPerOrderUsd(carrier, totalCbm, {
        assumedCbm: config.assumedShipmentCbm ?? DEFAULT_ASSUMED_SHIPMENT_CBM,
        useTrueCost: seaOpts?.useTrueCost ?? false,
      });
      return res.shipmentUsd / quantity;
    }
    // Legacy fallback: flat $/CBM with a 1-CBM floor (pre-carrier configs).
    if (shipping.seaRate && shipping.seaRate > 0) {
      return (Math.max(totalCbm, 1) * shipping.seaRate) / quantity;
    }
  }
  return 0;
}

/**
 * Inverse of the margin-on-price formula used in priceFactoryQuote: given a
 * target customer unit price, returns the margin (%) needed to reach it.
 * Single source of truth for the "תמחור לפי יעד" panels in BOTH the Dashboard
 * and Widget FinalizeModals — so the reverse math can never drift between them.
 *   margin = (productPrice − cost) / productPrice,  productPrice = price − shipping
 */
export function marginPctFromUnitPrice(
  perUnitPrice: number,
  unitCost: number,
  unitShipping: number
): number {
  const productPrice = perUnitPrice - unitShipping;
  return productPrice > 0 ? ((productPrice - unitCost) / productPrice) * 100 : 0;
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

  // One-time mold/tooling fee (CNY) — treated as a SEPARATE one-time line item.
  // Same margin formula as the bag, but it never gets folded into the per-unit
  // bag price. Customer sees it as its own row "תבניות (חד פעמי)" in the PDF.
  const moldsTotalCny = Math.max(input.moldsCostCny ?? 0, 0);
  const moldsPerUnitCny = moldsTotalCny > 0 ? moldsTotalCny / quantity : 0;

  // Plate ("plant") fee — factory-quoted per colour, spread per unit like
  // shipping. PASS-THROUGH, no margin: the customer pays exactly what the
  // factory charged per unit. Same subtract-then-add-back pattern as
  // shipping so the margin fraction only bites into the bag portion.
  const platePerColorCnyIn = Math.max(input.platePerColorCny ?? 0, 0);
  const logoColorsIn = Math.max(1, Math.floor(input.logoColors ?? 1));
  const plateFeeTotalCny =
    platePerColorCnyIn > 0 ? platePerColorCnyIn * logoColorsIn : 0;
  const platePerUnitCny =
    plateFeeTotalCny > 0 ? plateFeeTotalCny / quantity : 0;

  const unitProductionCny = input.factoryUnitCostCny;
  const unitCostUsd = unitProductionCny * cnyToUsd;
  const unitShippingUsd = computeShippingPerUnitUsd(
    shipping,
    totalWeightKg,
    totalCbm,
    quantity,
    config,
    { useTrueCost: input.seaUseTrueCost ?? false }
  );

  const unitCost = unitCostUsd * usdToTarget;
  const unitShipping = unitShippingUsd * usdToTarget;
  const platePerUnitIls = platePerUnitCny * cnyToUsd * usdToTarget;

  const marginPct =
    input.profitMarginOverride !== undefined
      ? input.profitMarginOverride
      : config.defaultProfitMargin;

  // Margin-on-price, matching the calculator (engine.ts): the margin is the
  // profit's share of the product price (excluding pass-through shipping AND
  // pass-through plate fee).
  // Clamp to <100% so a misconfigured value can never divide-by-zero / go negative.
  // Compute selling price exact first, round display only — profit must NOT be derived
  // from the rounded selling price or a per-unit rounding error compounds over quantity
  // (e.g. a 0.01 ILS/unit rounding delta × 10 000 units = 100 ILS difference between
  // sea and air for identical factory cost).
  const marginFrac = Math.min(Math.max(marginPct, 0), 99.9) / 100;
  const unitProductPriceExact = unitCost / (1 - marginFrac);
  const unitSellingPriceExact =
    unitProductPriceExact + unitShipping + platePerUnitIls;
  const unitSellingPrice = r2(unitSellingPriceExact);
  const unitProfitExact = unitProductPriceExact - unitCost;
  const unitProfit = r2(unitProfitExact);

  // Mold one-time: convert CNY → ILS. PASS-THROUGH — same cost charged to the
  // customer, no margin. So sellingPrice == cost and profit == 0.
  const moldsTotalCostIlsExact = moldsTotalCny * cnyToUsd * usdToTarget;
  const moldsTotalSellingPriceIlsExact = moldsTotalCostIlsExact;
  const moldsTotalProfitIlsExact = 0;

  // Plate fee grand total in ILS — pass-through, no margin.
  const plateFeeTotalCostIlsExact = plateFeeTotalCny * cnyToUsd * usdToTarget;

  const bagsCost = unitCost * quantity;
  const bagsProfit = unitProfitExact * quantity;
  const bagsSellingPrice = unitSellingPriceExact * quantity;

  const totalCost = r2(
    bagsCost + moldsTotalCostIlsExact + plateFeeTotalCostIlsExact
  );
  const totalShipping = r2(unitShipping * quantity);
  const totalProfit = r2(bagsProfit + moldsTotalProfitIlsExact);
  const totalSellingPrice = r2(
    bagsSellingPrice + moldsTotalSellingPriceIlsExact
  );

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
    commissionPct: config.commissionPct,
    moldsTotalCny: r2(moldsTotalCny),
    moldsPerUnitCny: Math.round(moldsPerUnitCny * 1000) / 1000,
    moldsTotalCostIls: r2(moldsTotalCostIlsExact),
    moldsTotalSellingPriceIls: r2(moldsTotalSellingPriceIlsExact),
    moldsTotalProfitIls: r2(moldsTotalProfitIlsExact),
    ...(plateFeeTotalCny > 0
      ? {
          platePerColorCny: r2(platePerColorCnyIn),
          plateFeeTotalCny: r2(plateFeeTotalCny),
          platePerUnitCny: Math.round(platePerUnitCny * 1000) / 1000,
          platePerUnitIls: r2(platePerUnitIls),
          plateFeeTotalCostIls: r2(plateFeeTotalCostIlsExact),
          plateFeeLogoColors: logoColorsIn,
        }
      : {}),
  };
}

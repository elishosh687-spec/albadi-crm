/**
 * Map a calculator QuoteResult (calculateQuote output) → FactoryPricingResult,
 * the shape stored in factory_quote_requests.final_pricing and read by the
 * quotes list + boss-breakdown surfaces. Used when SAVING a self-calculated
 * quote as a DRAFT ("שמור כטיוטה") — so the boss has a record of the exact price
 * he quoted the customer, without a factory response.
 *
 * IMPORTANT (molds): QuoteResult.totalOrderPriceIls INCLUDES the one-time molds
 * (engine.ts: sellingPricePerUnit × qty + moldsTotalSellingPriceIls), but
 * FactoryPricingResult.totalSellingPrice is BAGS-ONLY (molds live in their own
 * moldsTotalSellingPriceIls field). So totalSellingPrice = per-unit × qty here —
 * using totalOrderPriceIls would double-count the molds downstream.
 *
 * Pure + client-safe (no env, no I/O).
 */
import type { QuoteResult } from "./types";
import type { FactoryPricingResult } from "../types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function quoteResultToPricing(
  r: QuoteResult,
  productionPerUnitIls: number,
  shippingPerUnitIls: number,
  commissionPct?: number
): FactoryPricingResult {
  const q = Math.max(1, r.quantity);
  return {
    quantity: q,
    currency: "ILS",
    unitCost: r2(productionPerUnitIls),
    unitShipping: r2(shippingPerUnitIls),
    unitProfit: r2(r.profitPerUnitIls),
    unitSellingPrice: r2(r.sellingPricePerUnitIls),
    totalCost: r2(productionPerUnitIls * q),
    totalShipping: r2(shippingPerUnitIls * q),
    totalProfit: r2(r.totalProfitIls),
    totalSellingPrice: r2(r.sellingPricePerUnitIls * q), // bags only — molds separate
    totalCartons: r.totalCartons,
    totalWeightKg: r.totalWeightKg,
    totalCbm: r.totalCbm,
    profitMarginPct: r.profitMargin,
    shippingOptionId: r.shippingOption?.id ?? null,
    shippingOptionName: r.shippingOption?.name ?? null,
    commissionPct,
    moldsTotalCny: r.moldsTotalCny,
    moldsPerUnitCny: r.moldsPerUnitCny,
    moldsTotalCostIls: r.moldsTotalCostIls,
    moldsTotalSellingPriceIls: r.moldsTotalSellingPriceIls,
    moldsTotalProfitIls: r.moldsTotalProfitIls,
    plateFeeTotalCny: r.plateFeeCny || undefined,
  };
}

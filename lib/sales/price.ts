/**
 * Server-side pricing for the salesperson screen. Computes the FULL quote with
 * the shared engine (so the boss's stored record is identical to a boss-made
 * one), but the ONLY thing that leaves this module toward the sales client is
 * `SalesCustomerQuote` — customer-facing numbers, never cost/profit/margin/
 * commission/CBM/FX. That's the "hard hiding" (Eli 2026-08-04).
 */
import { calculateQuoteByCodes } from "@/lib/factory/calculator";
import { quoteResultToPricing } from "@/lib/factory/calculator/to-pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import { customerTotalExVat } from "@/lib/factory/customer-total";
import type { FactoryPricingResult, FactoryProductSpec } from "@/lib/factory/types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Same default as the boss calculator (CalculatorView MOLD_CNY_PER_COLOR) so a
 *  sales quote prices IDENTICALLY: one-time printing mold ¥500 per logo colour. */
const MOLD_CNY_PER_COLOR = 500;

export interface SalesCatalogInput {
  productId: string; // p1..p13
  quantityTierId?: string | null; // q0..q3
  quantityOverride?: number | null;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string; // s1 | s2 (or catalog ids)
}

/** The ONLY shape the sales client ever receives for a price. */
export interface SalesCustomerQuote {
  unitSellingPriceIls: number;
  totalOrderIls: number;
  quantity: number;
  shippingName: string;
  shippingDays: number | null;
  moldsTotalIls: number;
  dimensions: string;
  currency: "ILS";
}

/** Build the FactoryProductSpec the boss record stores, from the catalog result. */
function buildSpec(
  dimensions: string,
  description: string,
  quantity: number,
  input: SalesCatalogInput
): FactoryProductSpec {
  const dim = (letter: string) => {
    const m = dimensions.match(new RegExp(`${letter}(\\d+(?:\\.\\d+)?)`, "i"));
    return m ? Number(m[1]) : 0;
  };
  const finishing =
    (input.hasHandles ? "with handles" : "no handles") +
    (input.hasLamination ? " · laminated" : "");
  return {
    description: description || "שקית אלבדי",
    material: "80g non-woven",
    widthCm: dim("W"),
    heightCm: dim("H"),
    depthCm: dim("D"),
    quantity,
    printing: `${Math.max(1, input.logoColors)} colours`,
    finishing,
  } as FactoryProductSpec;
}

/**
 * Compute a catalog quote. Returns the FULL pricing (for the boss record) plus
 * the stripped customer view. `null` when the engine can't price it.
 */
export async function computeCatalogSales(
  input: SalesCatalogInput
): Promise<{ full: FactoryPricingResult; spec: FactoryProductSpec; customer: SalesCustomerQuote } | null> {
  const colors = Math.max(1, input.logoColors);
  const calc = await calculateQuoteByCodes({
    productId: input.productId,
    quantityTierId: input.quantityTierId ?? "",
    quantityOverride: input.quantityOverride ?? null,
    hasHandles: input.hasHandles,
    logoColors: colors,
    hasLamination: input.hasLamination,
    shippingOptionId: input.shippingOptionId,
    // Match the manual calculator's default (¥500 × colours) so the customer
    // price is identical to what the boss calculator would produce.
    moldsCostCny: MOLD_CNY_PER_COLOR * colors,
  });
  if (!calc?.result) return null;
  const r = calc.result;
  const cfg = await getFactoryConfig();

  const shippingPerUnitIls = r2(r.shippingPerUnitUsd * cfg.usdToIls);
  const productionPerUnitIls = r2(r.totalCostPerUnitIls - shippingPerUnitIls);
  const full = quoteResultToPricing(r, productionPerUnitIls, shippingPerUnitIls, cfg.commissionPct);

  const dimensions = r.product?.dimensions ?? "";
  const spec = buildSpec(dimensions, r.product?.description ?? "", full.quantity, input);
  const totalOrderIls = customerTotalExVat(full) ?? r2(full.totalSellingPrice);

  const customer: SalesCustomerQuote = {
    unitSellingPriceIls: full.unitSellingPrice,
    totalOrderIls: r2(totalOrderIls),
    quantity: full.quantity,
    shippingName: r.shippingOption?.name ?? "",
    shippingDays: r.shippingOption?.deliveryDays ?? null,
    moldsTotalIls: r2(full.moldsTotalSellingPriceIls ?? 0),
    dimensions,
    currency: "ILS",
  };
  return { full, spec, customer };
}

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
import { GHL_WIDGET_TOKEN } from "@/integrations/ghl/widget-auth";
import type { QuoteResult } from "@/lib/factory/calculator/types";
import type { FactoryPricingResult, FactoryProductSpec } from "@/lib/factory/types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Default one-time printing mold the sales screen pre-fills, in ¥ per logo
 *  colour. Eli 2026-08-04 wants the salesperson's default at ¥1000/colour (more
 *  room to discount), editable per quote down to 0. NOTE: the boss calculator's
 *  default is ¥500/colour — a sales quote left at this default prices slightly
 *  higher than a boss one until/unless the two defaults are aligned. */
const SALES_DEFAULT_MOLD_CNY_PER_COLOR = 1000;

export interface SalesCatalogInput {
  productId: string; // p1..p13
  quantityTierId?: string | null; // q0..q3
  quantityOverride?: number | null;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string; // s1 | s2 (or catalog ids)
  /** One-time mold in ¥ PER COLOUR — the salesperson can lower it (down to 0) as
   *  negotiation room. Undefined → the sales default (¥1000/colour). */
  moldPerColorCny?: number;
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
  // Salesperson's mold, ¥ per colour (default ¥1000, editable to 0). × colours.
  const perColor =
    input.moldPerColorCny !== undefined && input.moldPerColorCny >= 0
      ? input.moldPerColorCny
      : SALES_DEFAULT_MOLD_CNY_PER_COLOR;
  const calc = await calculateQuoteByCodes({
    productId: input.productId,
    quantityTierId: input.quantityTierId ?? "",
    quantityOverride: input.quantityOverride ?? null,
    hasHandles: input.hasHandles,
    logoColors: colors,
    hasLamination: input.hasLamination,
    shippingOptionId: input.shippingOptionId,
    moldsCostCny: r2(perColor * colors),
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

export interface SalesEstimateInput {
  widthCm: number;
  heightCm: number;
  depthCm: number;
  quantity: number;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string; // s1 | s2
  moldPerColorCny?: number;
}

/**
 * Compute an ESTIMATE (off-catalog dims) for the sales screen by proxying the
 * exact boss endpoint `/api/factory/estimate` server-side (with the boss token),
 * then stripping to the customer view. Proxying — rather than re-deriving —
 * guarantees the sales estimate prices IDENTICALLY to the boss estimate (same
 * carton model, buffer, plate fee, mold). `origin` = the request origin.
 *
 * Returns `{ refused: true }` when the estimator declines (off-grid spec → the
 * salesperson should use the "בקשת הצעה מהמפעל" tab).
 */
export async function computeEstimateSales(
  input: SalesEstimateInput,
  origin: string
): Promise<
  | { refused: true; reason?: string }
  | { refused: false; full: FactoryPricingResult; spec: FactoryProductSpec; customer: SalesCustomerQuote }
> {
  const colors = Math.max(1, input.logoColors);
  const perColor =
    input.moldPerColorCny !== undefined && input.moldPerColorCny >= 0
      ? input.moldPerColorCny
      : SALES_DEFAULT_MOLD_CNY_PER_COLOR;
  const qs = new URLSearchParams({
    widthCm: String(input.widthCm),
    heightCm: String(input.heightCm),
    depthCm: String(input.depthCm || 0),
    qty: String(Math.max(1, Math.round(input.quantity))),
    handles: String(input.hasHandles),
    lamination: String(input.hasLamination),
    colors: String(colors),
    shipping: input.shippingOptionId || "s2",
    moldsCostCny: String(r2(perColor * colors)),
    widget_token: GHL_WIDGET_TOKEN,
  });
  const res = await fetch(`${origin}/api/factory/estimate?${qs}`, { cache: "no-store" });
  const j = (await res.json()) as {
    ok?: boolean;
    result?: QuoteResult;
    estimate?: { refused?: string; factoryName?: string };
    computed?: { productionPerUnitIls: number; shippingPerUnitIls: number; commissionPct?: number };
  };
  if (!j?.result || !j.computed) {
    return { refused: true, reason: j?.estimate?.refused };
  }
  const r = j.result;
  const full = quoteResultToPricing(
    r,
    j.computed.productionPerUnitIls,
    j.computed.shippingPerUnitIls,
    j.computed.commissionPct
  );
  const dimensions = `H${input.heightCm}${input.depthCm ? `*D${input.depthCm}` : ""}*W${input.widthCm}`;
  const spec: FactoryProductSpec = {
    description: "שקית אלבדי (אומדן)",
    material: "80g non-woven",
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    depthCm: input.depthCm || 0,
    quantity: full.quantity,
    printing: `${colors} colours`,
    finishing:
      (input.hasHandles ? "with handles" : "no handles") + (input.hasLamination ? " · laminated" : ""),
  } as FactoryProductSpec;
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
  return { refused: false, full, spec, customer };
}

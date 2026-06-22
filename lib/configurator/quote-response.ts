import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import {
  calculateQuoteByCodes,
  resolveQuantityTier,
} from "@/lib/factory/calculator";
import type { QuoteResult } from "@/lib/factory/calculator";
import { customerBreakdownIls } from "@/lib/factory/calculator/customer-breakdown";

/**
 * Customer-safe per-unit price breakdown (ILS). Itemises only what the customer
 * chose — base bag, handles, lamination, logo colours. It deliberately exposes
 * NO factory costs, margin, profit, or a separate shipping line: shipping is
 * folded silently into `productIls`. The four parts always sum to `unitPriceIls`.
 */
export interface ConfiguratorQuoteBreakdown {
  /** Base bag selling price + shipping, folded together (the reconciling line). */
  productIls: number;
  /** Handles up-charge (0 when no handles). */
  handlesIls: number;
  /** Lamination up-charge incl. per-colour plate fee (0 when no lamination). */
  laminationIls: number;
  /** Logo-colour up-charge for non-laminated bags (0 when laminated or 1 colour). */
  logoColorsIls: number;
}

export interface ConfiguratorQuoteResponse {
  ok: true;
  productId: string;
  productDimensions: string;
  productDescription: string;
  quantity: number;
  quantityTierId: string;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string;
  shippingOptionName: string;
  shippingDeliveryDays: number;
  unitPriceIls: number;
  totalOrderIls: number;
  profitMargin: number;
  breakdown: ConfiguratorQuoteBreakdown;
  altShipping: {
    shippingOptionId: string;
    shippingOptionName: string;
    shippingDeliveryDays: number;
    unitPriceIls: number;
    totalOrderIls: number;
  } | null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function summarizeResult(result: QuoteResult) {
  return {
    unitPriceIls: round2(result.sellingPricePerUnitIls),
    totalOrderIls: round2(result.totalOrderPriceIls),
    profitMargin: round2(result.profitMargin),
    shippingOptionName: result.shippingOption?.name ?? "",
    shippingDeliveryDays: result.shippingOption?.deliveryDays ?? 0,
  };
}

export async function buildConfiguratorQuote(input: {
  productId: string;
  quantity: number;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string;
}): Promise<ConfiguratorQuoteResponse | null> {
  const product = DEFAULT_CONFIG.products.find((p) => p.id === input.productId);
  if (!product) return null;

  const tier = resolveQuantityTier(input.quantity);
  const out = await calculateQuoteByCodes({
    productId: input.productId,
    quantityTierId: tier.id,
    quantityOverride: tier.exact ? null : input.quantity,
    hasHandles: input.hasHandles,
    logoColors: input.logoColors,
    hasLamination: input.hasLamination,
    shippingOptionId: input.shippingOptionId,
  });
  if (!out) return null;

  const main = summarizeResult(out.result);
  const alt = out.altResult ? summarizeResult(out.altResult) : null;

  return {
    ok: true,
    productId: input.productId,
    productDimensions: product.dimensions,
    productDescription: product.description,
    quantity: out.result.quantity,
    quantityTierId: tier.id,
    hasHandles: input.hasHandles,
    logoColors: input.logoColors,
    hasLamination: input.hasLamination,
    shippingOptionId: input.shippingOptionId,
    shippingOptionName: main.shippingOptionName,
    shippingDeliveryDays: main.shippingDeliveryDays,
    unitPriceIls: main.unitPriceIls,
    totalOrderIls: main.totalOrderIls,
    profitMargin: main.profitMargin,
    breakdown: customerBreakdownIls(out.result),
    altShipping: alt
      ? {
          shippingOptionId: out.altResult!.shippingOption?.id ?? "",
          shippingOptionName: alt.shippingOptionName,
          shippingDeliveryDays: alt.shippingDeliveryDays,
          unitPriceIls: alt.unitPriceIls,
          totalOrderIls: alt.totalOrderIls,
        }
      : null,
  };
}

export const CONFIGURATOR_PRODUCTS = DEFAULT_CONFIG.products.map((p) => ({
  id: p.id,
  dimensions: p.dimensions,
  description: p.description,
}));

export const CONFIGURATOR_SHIPPING_OPTIONS = DEFAULT_CONFIG.shippingOptions
  .filter((s) => s.enabled)
  .map((s) => ({ id: s.id, name: s.name, description: s.description }));

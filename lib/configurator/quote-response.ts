import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import {
  calculateQuoteByCodes,
  resolveQuantityTier,
} from "@/lib/factory/calculator";
import type { QuoteResult } from "@/lib/factory/calculator";

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
  unitPriceIls: number;
  totalOrderIls: number;
  profitMargin: number;
  altShipping: {
    shippingOptionId: string;
    shippingOptionName: string;
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
    unitPriceIls: main.unitPriceIls,
    totalOrderIls: main.totalOrderIls,
    profitMargin: main.profitMargin,
    altShipping: alt
      ? {
          shippingOptionId: out.altResult!.shippingOption?.id ?? "",
          shippingOptionName: alt.shippingOptionName,
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

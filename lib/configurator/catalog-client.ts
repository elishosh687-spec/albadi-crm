import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

export const CONFIGURATOR_PRODUCT_OPTIONS = DEFAULT_CONFIG.products.map((p) => ({
  id: p.id,
  dimensions: p.dimensions,
  description: p.description,
}));

export const CONFIGURATOR_SHIPPING_OPTIONS = DEFAULT_CONFIG.shippingOptions
  .filter((s) => s.enabled)
  .map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
  }));

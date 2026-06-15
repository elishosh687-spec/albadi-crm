/**
 * Ported subset of bag-quote-app/lib/types.ts. Self-contained — no runtime
 * deps. Used by the bot quote flow and the customer PDF breakdown.
 */

export interface CartonInfo {
  qty: number;
  weight: number;
  length: number;
  width: number;
  height: number;
}

export interface PriceByQuantity {
  [quantityKey: string]: number; // e.g. "3000": 0.78 (CNY)
}

export interface ProductVariant {
  prices: PriceByQuantity;
  carton: CartonInfo;
  laminationPrices?: PriceByQuantity;
}

export interface Product {
  id: string;
  dimensions: string;
  description: string;
  withHandles: ProductVariant;
  withoutHandles: ProductVariant;
  sortOrder: number;
  laminationColorPlateFee?: number;
}

export interface ColorAddon {
  colors: number;
  pricesByQuantity: PriceByQuantity;
}

export interface QuantityTier {
  id: string;
  quantity: number;
  label: string;
  sortOrder: number;
}

export interface ShippingOption {
  id: string;
  name: string;
  description: string;
  deliveryDays: number;
  type: "air" | "sea" | "custom";
  enabled: boolean;
  airRates?: {
    thresholdKg: number;
    rateBelowThreshold: number;
    rateAboveThreshold: number;
  };
  seaRate?: number;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  costPrice: number;
  sellingPrice: number;
  enabled: boolean;
  sortOrder: number;
}

export interface ExchangeRates {
  usdToIls: number;
  usdToCny: number;
}

export interface AdminSettings {
  globalProfitMargin: number;
  profitMarginByQuantity?: Record<string, number>;
}

export interface AppConfig {
  products: Product[];
  colorAddons: ColorAddon[];
  quantityTiers: QuantityTier[];
  shippingOptions: ShippingOption[];
  features: Feature[];
  exchangeRates: ExchangeRates;
  adminSettings: AdminSettings;
}

export interface QuoteFormData {
  productId: string | null;
  quantityTierId: string | null;
  quantityOverride: number | null;
  hasHandles: boolean | null;
  logoColors: number;
  shippingOptionId: string | null;
  selectedFeatureIds: string[];
  // One-time mold/tooling fee from the factory, in CNY. Treated as a SEPARATE
  // one-time line in the quote (not amortized into per-bag price). The same
  // margin applies, but it surfaces as its own row in the PDF and breakdown.
  moldsCostCny?: number;
}

export interface QuoteResult {
  product: Product | null;
  quantity: number;
  hasHandles: boolean;
  logoColors: number;
  shippingOption: ShippingOption | null;
  selectedFeatures: Feature[];

  basePriceCny: number;
  colorAddonCny: number;

  baseBagCny: number;
  handlesAddonCny: number;
  laminationAddonCny: number;
  logoAddonCny: number;
  plateFeeCny: number;
  // One-time mold/tooling — separate line item, NOT folded into per-unit
  // selling/cost/profit. See FactoryPricingResult for field semantics.
  moldsTotalCny: number;
  moldsPerUnitCny: number;
  moldsTotalCostIls: number;
  moldsTotalSellingPriceIls: number;
  moldsTotalProfitIls: number;
  unitProductionCny: number;
  unitProductionUsd: number;
  totalCartons: number;
  totalWeightKg: number;
  totalCbm: number;
  shippingPerUnitUsd: number;
  finalUnitCostUsd: number;
  finalUnitCostIls: number;
  featuresTotalPerUnitIls: number;
  totalCostPerUnitIls: number;

  sellingPricePerUnitIls: number;
  totalOrderPriceIls: number;

  profitMargin: number;
  profitPerUnitIls: number;
  totalProfitIls: number;

  currency: string;
}

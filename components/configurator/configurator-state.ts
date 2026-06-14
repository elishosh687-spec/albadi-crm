export interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  company: string;
  quantity: number;
  notes: string;
}

export interface QuoteSpec {
  productId: string;
  quantity: number;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string;
}

export interface PricingInfo {
  quantity: number;
  unitPriceIls: number;
  totalOrderIls: number;
  productId: string;
  productDimensions: string;
  productDescription: string;
  shippingOptionId: string;
  shippingOptionName: string;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  profitMargin: number;
  altShipping: {
    shippingOptionId: string;
    shippingOptionName: string;
    unitPriceIls: number;
    totalOrderIls: number;
  } | null;
  loading: boolean;
  error: string | null;
}

export const DEFAULT_CUSTOMER_INFO: CustomerInfo = {
  name: "",
  email: "",
  phone: "",
  company: "",
  quantity: 1000,
  notes: "",
};

export const DEFAULT_QUOTE_SPEC: QuoteSpec = {
  productId: "p1",
  quantity: 1000,
  hasHandles: true,
  logoColors: 1,
  hasLamination: false,
  shippingOptionId: "s1",
};

export const DEFAULT_PRICING_INFO: PricingInfo = {
  quantity: DEFAULT_QUOTE_SPEC.quantity,
  unitPriceIls: 0,
  totalOrderIls: 0,
  productId: DEFAULT_QUOTE_SPEC.productId,
  productDimensions: "",
  productDescription: "",
  shippingOptionId: DEFAULT_QUOTE_SPEC.shippingOptionId,
  shippingOptionName: "",
  hasHandles: DEFAULT_QUOTE_SPEC.hasHandles,
  logoColors: DEFAULT_QUOTE_SPEC.logoColors,
  hasLamination: DEFAULT_QUOTE_SPEC.hasLamination,
  profitMargin: 0,
  altShipping: null,
  loading: true,
  error: null,
};

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function hasRequiredCustomerFields(customerInfo: CustomerInfo) {
  return Boolean(customerInfo.name.trim() && customerInfo.email.trim() && customerInfo.phone.trim());
}

export function normalizePricing(pricing: PricingInfo): PricingInfo {
  const quantity = Number.isFinite(pricing.quantity)
    ? Math.max(1, Math.round(pricing.quantity))
    : 1;
  const unitPriceIls = Number.isFinite(pricing.unitPriceIls)
    ? Math.max(0, pricing.unitPriceIls)
    : 0;
  const totalOrderIls = Number.isFinite(pricing.totalOrderIls)
    ? Math.max(0, pricing.totalOrderIls)
    : 0;

  return {
    ...pricing,
    quantity,
    unitPriceIls,
    totalOrderIls,
  };
}

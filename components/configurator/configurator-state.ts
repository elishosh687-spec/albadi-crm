export interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  company: string;
  quantity: number;
  notes: string;
}

export interface PricingInfo {
  unitPrice: number;
  setupFee: number;
  quantity: number;
  totalPrice: number;
}

export const DEFAULT_CUSTOMER_INFO: CustomerInfo = {
  name: "",
  email: "",
  phone: "",
  company: "",
  quantity: 500,
  notes: "",
};

export const DEFAULT_PRICING_INFO: PricingInfo = {
  unitPrice: 0.68,
  setupFee: 35,
  quantity: DEFAULT_CUSTOMER_INFO.quantity,
  totalPrice: 0,
};

export function calculateTotalPrice(quantity: number, unitPrice: number, setupFee: number) {
  const safeQuantity = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const safeUnitPrice = Number.isFinite(unitPrice) ? Math.max(0, unitPrice) : 0;
  const safeSetupFee = Number.isFinite(setupFee) ? Math.max(0, setupFee) : 0;

  return Number((safeQuantity * safeUnitPrice + safeSetupFee).toFixed(2));
}

export function normalizePricing(pricing: PricingInfo): PricingInfo {
  const quantity = Number.isFinite(pricing.quantity) ? Math.max(0, pricing.quantity) : 0;
  const unitPrice = Number.isFinite(pricing.unitPrice) ? Math.max(0, pricing.unitPrice) : 0;
  const setupFee = Number.isFinite(pricing.setupFee) ? Math.max(0, pricing.setupFee) : 0;

  return {
    quantity,
    unitPrice,
    setupFee,
    totalPrice: calculateTotalPrice(quantity, unitPrice, setupFee),
  };
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function hasRequiredCustomerFields(customerInfo: CustomerInfo) {
  return Boolean(customerInfo.name.trim() && customerInfo.email.trim() && customerInfo.phone.trim());
}

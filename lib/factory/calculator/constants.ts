/**
 * Ported verbatim from bag-quote-app/lib/constants.ts (April 2026, +15% bump).
 * Source of truth for the 14 fixed-size products and their factory prices.
 * If the bag-quote-app updates these, re-copy here. Pure data — no logic.
 */

import type {
  AppConfig,
  Product,
  ColorAddon,
  QuantityTier,
  ShippingOption,
  Feature,
  ExchangeRates,
  AdminSettings,
} from "./types";

const DEFAULT_PRODUCTS: Product[] = [
  {
    id: "p1", dimensions: "20×8×25", description: "מתאים לקוסמטיקה, תכשיטים, אקססוריז", sortOrder: 1,
    laminationColorPlateFee: 345,
    withHandles: { prices: { "1000": 1.5, "3000": 0.9, "5000": 0.69, "10000": 0.57 }, carton: { qty: 250, weight: 5.5, length: 40, width: 24, height: 48 }, laminationPrices: { "1000": 2.64, "3000": 1.73, "5000": 0.81, "10000": 0.63 } },
    withoutHandles: { prices: { "1000": 1.44, "3000": 0.83, "5000": 0.75, "10000": 0.52 }, carton: { qty: 250, weight: 4, length: 30, width: 24, height: 48 }, laminationPrices: { "1000": 2.53, "3000": 1.61, "5000": 0.75, "10000": 0.62 } },
  },
  {
    id: "p2", dimensions: "30×10×30", description: "מתאים לביגוד קל, מתנות", sortOrder: 2,
    laminationColorPlateFee: 357,
    withHandles: { prices: { "1000": 1.61, "3000": 1.02, "5000": 0.84, "10000": 0.7 }, carton: { qty: 250, weight: 8, length: 45, width: 34, height: 48 }, laminationPrices: { "1000": 2.76, "3000": 1.81, "5000": 0.9, "10000": 0.79 } },
    withoutHandles: { prices: { "1000": 1.56, "3000": 0.97, "5000": 0.78, "10000": 0.63 }, carton: { qty: 250, weight: 7, length: 34, width: 34, height: 48 }, laminationPrices: { "1000": 2.64, "3000": 1.73, "5000": 0.86, "10000": 0.75 } },
  },
  {
    id: "p3", dimensions: "40×12×30", description: "מתאים לנעליים, ביגוד, קופסאות", sortOrder: 3,
    laminationColorPlateFee: 460,
    withHandles: { prices: { "1000": 1.75, "3000": 1.12, "5000": 0.97, "10000": 0.83 }, carton: { qty: 250, weight: 10, length: 45, width: 45, height: 48 }, laminationPrices: { "1000": 2.82, "3000": 1.89, "5000": 1.09, "10000": 1.02 } },
    withoutHandles: { prices: { "1000": 1.69, "3000": 1.06, "5000": 0.91, "10000": 0.77 }, carton: { qty: 250, weight: 9, length: 45, width: 35, height: 48 }, laminationPrices: { "1000": 2.75, "3000": 1.83, "5000": 1.03, "10000": 0.97 } },
  },
  {
    id: "p4", dimensions: "40×15×50", description: "מתאים לפריטים גדולים", sortOrder: 4,
    laminationColorPlateFee: 943,
    withHandles: { prices: { "1000": 2.42, "3000": 1.5, "5000": 1.28, "10000": 1.18 }, carton: { qty: 200, weight: 12, length: 65, width: 45, height: 40 }, laminationPrices: { "1000": 3.57, "3000": 2.64, "5000": 1.5, "10000": 1.38 } },
    withoutHandles: { prices: { "1000": 2.35, "3000": 1.43, "5000": 1.22, "10000": 1.13 }, carton: { qty: 200, weight: 11.5, length: 55, width: 44, height: 40 }, laminationPrices: { "1000": 3.33, "3000": 2.64, "5000": 1.45, "10000": 1.36 } },
  },
  {
    id: "p5", dimensions: "30×40", description: "מתאים לפריטים רחבים", sortOrder: 5,
    laminationColorPlateFee: 345,
    withHandles: { prices: { "1000": 1.78, "3000": 0.87, "5000": 0.69, "10000": 0.59 }, carton: { qty: 500, weight: 13, length: 55, width: 34, height: 50 }, laminationPrices: { "1000": 2.53, "3000": 1.59, "5000": 0.76, "10000": 0.68 } },
    withoutHandles: { prices: { "1000": 1.73, "3000": 0.81, "5000": 0.63, "10000": 0.53 }, carton: { qty: 500, weight: 11, length: 44, width: 34, height: 50 }, laminationPrices: { "1000": 2.3, "3000": 1.5, "5000": 0.69, "10000": 0.62 } },
  },
  {
    id: "p6", dimensions: "20×15", description: "מתאים לפריטים קטנים", sortOrder: 6,
    laminationColorPlateFee: 345,
    withHandles: { prices: { "1000": 1.61, "3000": 0.67, "5000": 0.47, "10000": 0.38 }, carton: { qty: 500, weight: 6, length: 30, width: 25, height: 50 }, laminationPrices: { "1000": 2.32, "3000": 1.44, "5000": 0.56, "10000": 0.4 } },
    withoutHandles: { prices: { "1000": 1.56, "3000": 0.61, "5000": 0.43, "10000": 0.33 }, carton: { qty: 500, weight: 4, length: 24, width: 20, height: 50 }, laminationPrices: { "1000": 2.28, "3000": 1.39, "5000": 0.53, "10000": 0.37 } },
  },
  {
    id: "p7", dimensions: "15×5×20", description: "תיק קטן צר — מתאים למוצרי יוקרה", sortOrder: 7,
    laminationColorPlateFee: 345,
    withHandles: { prices: { "1000": 1.55, "3000": 0.81, "5000": 0.6, "10000": 0.46 }, carton: { qty: 500, weight: 7, length: 36, width: 36, height: 48 }, laminationPrices: { "1000": 2.56, "3000": 1.55, "5000": 0.77, "10000": 0.68 } },
    withoutHandles: { prices: { "1000": 1.5, "3000": 0.76, "5000": 0.57, "10000": 0.46 }, carton: { qty: 500, weight: 5.2, length: 36, width: 25, height: 48 }, laminationPrices: { "1000": 2.47, "3000": 1.5, "5000": 0.71, "10000": 0.63 } },
  },
  {
    id: "p8", dimensions: "35×10×40", description: "תיק בינוני-גדול — מתאים לביגוד וקופסאות", sortOrder: 8,
    laminationColorPlateFee: 529,
    withHandles: { prices: { "1000": 1.95, "3000": 1.22, "5000": 1.03, "10000": 0.9 }, carton: { qty: 250, weight: 11, length: 55, width: 40, height: 50 }, laminationPrices: { "1000": 3.11, "3000": 2.1, "5000": 1.36, "10000": 1.26 } },
    withoutHandles: { prices: { "1000": 1.9, "3000": 1.06, "5000": 0.89, "10000": 0.77 }, carton: { qty: 250, weight: 10, length: 44, width: 40, height: 48 }, laminationPrices: { "1000": 2.99, "3000": 2.05, "5000": 1.3, "10000": 1.18 } },
  },
  {
    id: "p9", dimensions: "45×15×40", description: "תיק גדול — מתאים לאריזות מתנה גדולות", sortOrder: 9,
    laminationColorPlateFee: 690,
    withHandles: { prices: { "1000": 2.16, "3000": 1.48, "5000": 1.25, "10000": 1.09 }, carton: { qty: 250, weight: 14.5, length: 55, width: 49, height: 50 }, laminationPrices: { "1000": 3.22, "3000": 2.42, "5000": 1.5, "10000": 1.38 } },
    withoutHandles: { prices: { "1000": 2.09, "3000": 1.28, "5000": 1.12, "10000": 1 }, carton: { qty: 250, weight: 13.2, length: 50, width: 44, height: 48 }, laminationPrices: { "1000": 3.16, "3000": 2.36, "5000": 1.43, "10000": 1.31 } },
  },
  {
    id: "p10", dimensions: "50×20×60", description: "תיק XL — מתאים לפריטים גדולים מאוד", sortOrder: 10,
    laminationColorPlateFee: 874,
    withHandles: { prices: { "1000": 3.22, "3000": 3.33, "5000": 3.22, "10000": 3.13 }, carton: { qty: 100, weight: 10, length: 75, width: 55, height: 20 }, laminationPrices: { "1000": 3.85, "3000": 3.57 } },
    withoutHandles: { prices: { "1000": 3.13, "3000": 3.23, "5000": 3.11, "10000": 2.99 }, carton: { qty: 100, weight: 9.2, length: 65, width: 55, height: 20 }, laminationPrices: { "1000": 3.78, "3000": 3.51 } },
  },
  {
    id: "p11", dimensions: "10×8", description: "תיק מיני — מתאים לתכשיטים, מתנות קטנות", sortOrder: 11,
    laminationColorPlateFee: 345,
    withHandles: { prices: { "1000": 1.26, "3000": 0.86, "5000": 0.82, "10000": 0.78 }, carton: { qty: 1000, weight: 7, length: 36, width: 26, height: 30 }, laminationPrices: { "1000": 2.18, "3000": 1.38 } },
    withoutHandles: { prices: { "1000": 1.21, "3000": 0.83, "5000": 0.78, "10000": 0.75 }, carton: { qty: 600, weight: 5, length: 36, width: 20, height: 30 }, laminationPrices: { "1000": 2.12, "3000": 1.32 } },
  },
  {
    id: "p12", dimensions: "15×10", description: "תיק קטן — מתאים לאקססוריז", sortOrder: 12,
    laminationColorPlateFee: 345,
    withHandles: { prices: { "1000": 1.31, "3000": 0.9, "5000": 0.84, "10000": 0.82 }, carton: { qty: 600, weight: 4.5, length: 36, width: 25, height: 20 }, laminationPrices: { "1000": 2.3, "3000": 1.47 } },
    withoutHandles: { prices: { "1000": 1.26, "3000": 0.85, "5000": 0.82, "10000": 0.78 }, carton: { qty: 600, weight: 3.5, length: 20, width: 14, height: 20 }, laminationPrices: { "1000": 2.25, "3000": 1.43 } },
  },
  {
    id: "p13", dimensions: "25×25", description: "תיק ריבועי — מתאים למוצרים מרובעים", sortOrder: 13,
    laminationColorPlateFee: 345,
    withHandles: { prices: { "1000": 1.58, "3000": 0.77, "5000": 0.72, "10000": 0.69 }, carton: { qty: 500, weight: 9, length: 40, width: 30, height: 45 }, laminationPrices: { "1000": 2.5, "3000": 1.5, "5000": 0.75, "10000": 0.7 } },
    withoutHandles: { prices: { "1000": 1.52, "3000": 0.72, "5000": 0.68, "10000": 0.64 }, carton: { qty: 500, weight: 8, length: 30, width: 30, height: 45 }, laminationPrices: { "1000": 2.44, "3000": 1.44, "5000": 0.69, "10000": 0.66 } },
  },
  {
    id: "p14", dimensions: "35×50", description: "תיק רחב — מתאים לפריטים שטוחים גדולים", sortOrder: 14,
    laminationColorPlateFee: 460,
    withHandles: { prices: { "1000": 1.73, "3000": 1.41, "5000": 1.36, "10000": 1.33 }, carton: { qty: 300, weight: 12, length: 65, width: 40, height: 25 }, laminationPrices: { "1000": 2.7, "3000": 1.76, "5000": 0.9, "10000": 0.85 } },
    withoutHandles: { prices: { "1000": 1.67, "3000": 1.33, "5000": 1.28, "10000": 1.25 }, carton: { qty: 300, weight: 10.5, length: 54, width: 39, height: 25 }, laminationPrices: { "1000": 2.64, "3000": 1.7, "5000": 0.84, "10000": 0.81 } },
  },
];

const DEFAULT_COLOR_ADDONS: ColorAddon[] = [
  { colors: 1, pricesByQuantity: { "1000": 0, "3000": 0, "5000": 0, "10000": 0 } },
  { colors: 2, pricesByQuantity: { "1000": 0.18, "3000": 0.15, "5000": 0.12, "10000": 0.10 } },
  { colors: 3, pricesByQuantity: { "1000": 0.37, "3000": 0.30, "5000": 0.25, "10000": 0.20 } },
];

const DEFAULT_QUANTITY_TIERS: QuantityTier[] = [
  { id: "q0", quantity: 1000, label: "1,000 יחידות", sortOrder: 0 },
  { id: "q1", quantity: 3000, label: "3,000 יחידות", sortOrder: 1 },
  { id: "q2", quantity: 5000, label: "5,000 יחידות", sortOrder: 2 },
  { id: "q3", quantity: 10000, label: "10,000 יחידות", sortOrder: 3 },
];

const DEFAULT_SHIPPING_OPTIONS: ShippingOption[] = [
  {
    id: "s1", name: "אקספרס", description: "אספקה תוך ~25 יום",
    deliveryDays: 25, type: "air", enabled: true,
    airRates: { thresholdKg: 100, rateBelowThreshold: 13, rateAboveThreshold: 8.5 },
  },
  {
    id: "s2", name: "רגיל", description: "אספקה תוך ~90 יום",
    deliveryDays: 90, type: "sea", enabled: true, seaRate: 500,
  },
];

const DEFAULT_FEATURES: Feature[] = [
  { id: "f1", name: "למינציה", description: "מראה יוקרתי, עמידות גבוהה ודחיית נוזלים", costPrice: 0, sellingPrice: 0, enabled: true, sortOrder: 1 },
];

const DEFAULT_EXCHANGE_RATES: ExchangeRates = { usdToIls: 3.6, usdToCny: 7.2 };

const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  globalProfitMargin: 40,
  profitMarginByQuantity: { "1000": 40, "3000": 40, "5000": 40, "10000": 40 },
};

export const DEFAULT_CONFIG: AppConfig = {
  products: DEFAULT_PRODUCTS,
  colorAddons: DEFAULT_COLOR_ADDONS,
  quantityTiers: DEFAULT_QUANTITY_TIERS,
  shippingOptions: DEFAULT_SHIPPING_OPTIONS,
  features: DEFAULT_FEATURES,
  exchangeRates: DEFAULT_EXCHANGE_RATES,
  adminSettings: DEFAULT_ADMIN_SETTINGS,
};

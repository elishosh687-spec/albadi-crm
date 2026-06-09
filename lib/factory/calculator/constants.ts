/**
 * Source of truth for the fixed-size products and their factory prices.
 * Note: p10 (H50*D20*W60), p11 (H8*W10), p14 (H35*W50) were retired 2026-06-09 —
 * the factory gave them no real volume discount, so a falling customer price
 * could not be guaranteed. Ids are intentionally left non-contiguous.
 * Imported from newfactory.xlsx (May 2026 — Kunming Shengximengtai Trading).
 * To re-import after factory updates: `npx tsx scripts/import-new-factory.ts`.
 * Pure data — no logic.
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

// Generated from newfactory.xlsx (May 2026 update 2 — Kunming Shengximengtai Trading).
// Values are CNY per unit. Plate fee (laminationColorPlateFee) varies per product
// per the xlsx 版费 column — ¥290–820/color.
// p1 (H20*D8*W25) kept from prior import — factory renamed sheet to
// H20*D8（9）*W25 with ambiguous H20*D9 cells, awaiting clarification.
// New factory size H15*D9*W20 deliberately not adopted (stack kept at 14).
// To re-import: `npx tsx scripts/_flatten-xlsx.py && npx tsx scripts/import-new-factory.ts`.
const DEFAULT_PRODUCTS: Product[] = [
  {
    id: "p1", dimensions: "H20*D8*W25", description: "מתאים לקוסמטיקה, תכשיטים, אקססוריז", sortOrder: 1,
    laminationColorPlateFee: 300,
    withHandles: { prices: { "1000": 1.3, "3000": 0.78, "5000": 0.6, "10000": 0.5 }, carton: { qty: 250, weight: 5.5, length: 40, width: 24, height: 48 }, laminationPrices: { "1000": 2.3, "3000": 1.5, "5000": 0.7, "10000": 0.55 } },
    withoutHandles: { prices: { "1000": 1.25, "3000": 0.72, "5000": 0.55, "10000": 0.45 }, carton: { qty: 250, weight: 4, length: 30, width: 24, height: 48 }, laminationPrices: { "1000": 2.2, "3000": 1.4, "5000": 0.65, "10000": 0.54 } },
  },
  {
    id: "p2", dimensions: "H30*D10*W30", description: "מתאים לביגוד קל, מתנות", sortOrder: 2,
    laminationColorPlateFee: 290,
    withHandles: { prices: { "1000": 1.4, "3000": 0.89, "5000": 0.65, "10000": 0.6 }, carton: { qty: 250, weight: 8, length: 45, width: 34, height: 48 }, laminationPrices: { "1000": 2.4, "3000": 1.57, "5000": 0.69, "10000": 0.67 } },
    withoutHandles: { prices: { "1000": 1.36, "3000": 0.84, "5000": 0.63, "10000": 0.58 }, carton: { qty: 250, weight: 7, length: 34, width: 34, height: 48 }, laminationPrices: { "1000": 2.3, "3000": 1.5, "5000": 0.67, "10000": 0.65 } },
  },
  {
    id: "p3", dimensions: "H30*D12*W40", description: "מתאים לנעליים, ביגוד, קופסאות", sortOrder: 3,
    laminationColorPlateFee: 390,
    withHandles: { prices: { "1000": 1.4, "3000": 0.97, "5000": 0.78, "10000": 0.72 }, carton: { qty: 250, weight: 10, length: 45, width: 45, height: 48 }, laminationPrices: { "1000": 2.45, "3000": 1.64, "5000": 0.85, "10000": 0.83 } },
    withoutHandles: { prices: { "1000": 1.36, "3000": 0.92, "5000": 0.76, "10000": 0.67 }, carton: { qty: 250, weight: 9, length: 45, width: 35, height: 48 }, laminationPrices: { "1000": 2.39, "3000": 1.59, "5000": 0.83, "10000": 0.81 } },
  },
  {
    id: "p4", dimensions: "H40*D15*W50", description: "מתאים לפריטים גדולים", sortOrder: 4,
    laminationColorPlateFee: 615,
    withHandles: { prices: { "1000": 2.1, "3000": 1.3, "5000": 1.05, "10000": 1 }, carton: { qty: 200, weight: 12, length: 65, width: 45, height: 40 }, laminationPrices: { "1000": 3.1, "3000": 2.3, "5000": 1.27, "10000": 1.25 } },
    withoutHandles: { prices: { "1000": 2.04, "3000": 1.24, "5000": 1.03, "10000": 0.98 }, carton: { qty: 200, weight: 11.5, length: 55, width: 44, height: 40 }, laminationPrices: { "1000": 2.9, "3000": 2.3, "5000": 1.25, "10000": 1.18 } },
  },
  {
    id: "p5", dimensions: "H30*W40", description: "מתאים לפריטים רחבים", sortOrder: 5,
    laminationColorPlateFee: 300,
    withHandles: { prices: { "1000": 1.4, "3000": 0.76, "5000": 0.6, "10000": 0.51 }, carton: { qty: 500, weight: 13, length: 55, width: 34, height: 50 }, laminationPrices: { "1000": 2.2, "3000": 1.38, "5000": 0.66, "10000": 0.59 } },
    withoutHandles: { prices: { "1000": 1.35, "3000": 0.7, "5000": 0.55, "10000": 0.46 }, carton: { qty: 500, weight: 11, length: 44, width: 34, height: 50 }, laminationPrices: { "1000": 2, "3000": 1.3, "5000": 0.6, "10000": 0.54 } },
  },
  {
    id: "p6", dimensions: "H15*W20", description: "מתאים לפריטים קטנים", sortOrder: 6,
    laminationColorPlateFee: 300,
    withHandles: { prices: { "1000": 1.3, "3000": 0.58, "5000": 0.41, "10000": 0.33 }, carton: { qty: 500, weight: 6, length: 30, width: 25, height: 50 }, laminationPrices: { "1000": 2.02, "3000": 1.25, "5000": 0.49, "10000": 0.35 } },
    withoutHandles: { prices: { "1000": 1.2, "3000": 0.53, "5000": 0.55, "10000": 0.37 }, carton: { qty: 500, weight: 4, length: 24, width: 20, height: 50 }, laminationPrices: { "1000": 1.98, "3000": 1.21, "5000": 0.46, "10000": 0.32 } },
  },
  {
    id: "p7", dimensions: "H15*D5*W20", description: "תיק קטן צר — מתאים למוצרי יוקרה", sortOrder: 7,
    laminationColorPlateFee: 300,
    withHandles: { prices: { "1000": 1.35, "3000": 0.7, "5000": 0.52, "10000": 0.4 }, carton: { qty: 500, weight: 7, length: 36, width: 36, height: 48 }, laminationPrices: { "1000": 2.23, "3000": 1.35, "5000": 0.67, "10000": 0.59 } },
    withoutHandles: { prices: { "1000": 1.3, "3000": 0.66, "5000": 0.5, "10000": 0.4 }, carton: { qty: 500, weight: 5.2, length: 36, width: 25, height: 48 }, laminationPrices: { "1000": 2.15, "3000": 1.3, "5000": 0.62, "10000": 0.55 } },
  },
  {
    id: "p8", dimensions: "H35*D10*W40", description: "תיק בינוני-גדול — מתאים לביגוד וקופסאות", sortOrder: 8,
    laminationColorPlateFee: 405,
    withHandles: { prices: { "1000": 1.7, "3000": 1.06, "5000": 0.8, "10000": 0.75 }, carton: { qty: 250, weight: 11, length: 55, width: 40, height: 50 }, laminationPrices: { "1000": 2.7, "3000": 1.83, "5000": 0.89, "10000": 0.87 } },
    withoutHandles: { prices: { "1000": 1.65, "3000": 0.92, "5000": 0.77, "10000": 0.67 }, carton: { qty: 250, weight: 10, length: 44, width: 40, height: 48 }, laminationPrices: { "1000": 2.6, "3000": 1.78, "5000": 0.87, "10000": 0.85 } },
  },
  {
    id: "p9", dimensions: "H40*D15*W45", description: "תיק גדול — מתאים לאריזות מתנה גדולות", sortOrder: 9,
    laminationColorPlateFee: 570,
    withHandles: { prices: { "1000": 1.88, "3000": 1.29, "5000": 1, "10000": 0.95 }, carton: { qty: 250, weight: 14.5, length: 55, width: 49, height: 50 }, laminationPrices: { "1000": 2.8, "3000": 2.1, "5000": 1.2, "10000": 1.18 } },
    withoutHandles: { prices: { "1000": 1.82, "3000": 1.11, "5000": 0.97, "10000": 0.87 }, carton: { qty: 250, weight: 13.2, length: 50, width: 44, height: 48 }, laminationPrices: { "1000": 2.75, "3000": 2.05, "5000": 1.18, "10000": 1.14 } },
  },
  {
    id: "p12", dimensions: "H10*W15", description: "תיק קטן — מתאים לאקססוריז", sortOrder: 12,
    laminationColorPlateFee: 300,
    withHandles: { prices: { "1000": 1.14, "3000": 0.78, "5000": 0.73, "10000": 0.71 }, carton: { qty: 600, weight: 4.5, length: 36, width: 25, height: 20 }, laminationPrices: { "1000": 2, "3000": 1.28 } },
    withoutHandles: { prices: { "1000": 1.1, "3000": 0.74, "5000": 0.71, "10000": 0.68 }, carton: { qty: 600, weight: 3.5, length: 20, width: 14, height: 20 }, laminationPrices: { "1000": 1.96, "3000": 1.24 } },
  },
  {
    id: "p13", dimensions: "H25*W25", description: "תיק ריבועי — מתאים למוצרים מרובעים", sortOrder: 13,
    laminationColorPlateFee: 300,
    withHandles: { prices: { "1000": 1.37, "3000": 0.67, "5000": 0.63, "10000": 0.6 }, carton: { qty: 500, weight: 9, length: 40, width: 30, height: 45 }, laminationPrices: { "1000": 2.17, "3000": 1.3, "5000": 0.65, "10000": 0.61 } },
    withoutHandles: { prices: { "1000": 1.32, "3000": 0.63, "5000": 0.59, "10000": 0.56 }, carton: { qty: 500, weight: 8, length: 30, width: 30, height: 45 }, laminationPrices: { "1000": 2.12, "3000": 1.25, "5000": 0.6, "10000": 0.57 } },
  },
];

const DEFAULT_COLOR_ADDONS: ColorAddon[] = [
  { colors: 1, pricesByQuantity: { "1000": 0, "3000": 0, "5000": 0, "10000": 0 } },
  { colors: 2, pricesByQuantity: { "1000": 0.18, "3000": 0.15, "5000": 0.09, "10000": 0.08 } },
  { colors: 3, pricesByQuantity: { "1000": 0.37, "3000": 0.3, "5000": 0.21, "10000": 0.18 } },
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

/**
 * Type definitions for the factory quote pipeline.
 * Mirrors the schema in drizzle/schema.ts (factoryQuoteRequests JSONB columns).
 */

export type FactoryQuoteStatus =
  | "draft"
  | "pending"
  | "received"
  | "finalized";

export interface FactoryProductSpec {
  description: string;
  material: string;
  widthCm: number;
  heightCm: number;
  depthCm: number;       // 0 = flat bag
  quantity: number;
  printing: string;      // e.g. "3 color(s)"
  finishing: string;     // e.g. "Handles / not laminated"
  picUrl?: string;
  notes?: string;
  // Customer's shipping choice from the bot questionnaire (`s1` / `s2`).
  // Carried so the FinalizeModal pre-selects what the customer actually
  // asked for instead of defaulting to the first enabled option (which used
  // to land on express even when the lead chose sea). Optional for back-compat
  // with rows written before this field existed.
  shippingOptionId?: string;
}

export interface FactoryResponse {
  unitCostCny: number;
  cartonQty?: number;
  cartonLengthCm?: number;
  cartonWidthCm?: number;
  cartonHeightCm?: number;
  cartonCbm?: number;
  weightKg?: number;
  supplier?: string;
  notes?: string;
}

export interface ShippingOption {
  id: string;
  name: string;
  type: "sea" | "air";
  enabled: boolean;
  seaRate?: number; // USD per CBM
  airRates?: {
    thresholdKg: number;
    rateBelowThreshold: number; // USD per kg below threshold
    rateAboveThreshold: number; // USD per kg at/above threshold
  };
}

export interface FactoryPricingConfig {
  shippingOptions: ShippingOption[];
  /** USD → ILS conversion (factory quotes are CNY → USD → ILS) */
  usdToIls: number;
  /** CNY → USD divisor (i.e. 1 USD = X CNY) */
  usdToCny: number;
  /** ILS → CNY rate. Manual (NOT auto-derived from USD rates) so it can
   *  drift independently when needed. Shown in the boss view of every
   *  quote for cost reference. Optional — falls back to derived value
   *  (usdToCny / usdToIls) when missing. */
  ilsToCny?: number;
  /** Default profit margin % when caller doesn't override and no per-qty value */
  defaultProfitMargin: number;
  /**
   * Profit margin % per quantity tier. Keys are quantity strings matching
   * `quantityTiers[].quantity` (e.g. "1000","3000","5000","10000"). Falls back
   * to `defaultProfitMargin` when the customer's quantity isn't in the map.
   * Used by the WhatsApp questionnaire calculator AND the FinalizeModal slider
   * initial value.
   */
  profitMarginByQuantity?: Record<string, number>;
  /** Currency code for customer display; always "ILS" for now */
  currency: "ILS";
}

export interface FactoryPricingInput {
  factoryUnitCostCny: number;
  quantity: number;
  shippingOptionId: string | null;
  cartonSpec?: {
    qty?: number;
    weightKg?: number;
    cbm?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
  };
  /** Override the default margin (e.g. slider 30-50%) */
  profitMarginOverride?: number;
}

export interface FactoryPricingResult {
  quantity: number;
  currency: "ILS";

  // per-unit, target currency (ILS)
  unitCost: number;
  unitShipping: number;
  unitProfit: number;
  unitSellingPrice: number;

  // totals, ILS
  totalCost: number;
  totalShipping: number;
  totalProfit: number;
  totalSellingPrice: number;

  // logistics
  totalCartons: number;
  totalWeightKg: number;
  totalCbm: number;

  // meta
  profitMarginPct: number;
  shippingOptionId: string | null;
  shippingOptionName: string | null;
}

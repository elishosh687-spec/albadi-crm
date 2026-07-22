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
  // Product title shown in the customer PDF headline. Defaults to "שקית אלבדי"
  // when empty. Editable in the FinalizeModal so the boss can rename the
  // product when it isn't a bag. Optional for back-compat.
  productName?: string;
  // Free-text note rendered in the customer PDF ("הערות") — editable in the
  // FinalizeModal before generating the PDF. Optional for back-compat.
  customerNotes?: string;
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
  /** Plate ("plant") fee per print colour in CNY, extracted from column T of
   *  the factory-quote sheet. When present + laminated + logoColors > 0,
   *  the pricing engine treats platePerColorCny × logoColors as a
   *  pass-through cost distributed across the order (no margin). */
  platePerColorCny?: number;
}

export interface ShippingOption {
  id: string;
  name: string;
  type: "sea" | "air";
  enabled: boolean;
  seaRate?: number; // USD per CBM — LEGACY flat rate. Superseded by the
  // active SeaCarrierProfile (see seaCarriers below). Kept only as a fallback
  // for configs written before carrier profiles existed.
  airRates?: {
    thresholdKg: number;
    rateBelowThreshold: number; // USD per kg below threshold
    rateAboveThreshold: number; // USD per kg at/above threshold
  };
}

/**
 * A sea-freight cost profile for ONE forwarder (e.g. "ידים לוגיסטיקה"),
 * SIMPLIFIED: just the bottom-line **cost per CBM** at each whole shipment
 * volume from 1 to 7 CBM — exactly the "עלות לקוב" row of the forwarder's
 * pricing sheet. No component breakdown. Switching/adding a forwarder = type
 * its 7 numbers off its sheet.
 *
 * `perCbmByLevel[i]` = USD cost per CBM when the whole shipment is (i+1) CBM.
 * So index 0 → 1 CBM, index 2 → 3 CBM, index 6 → 7 CBM. Total cost at an
 * integer level L = perCbmByLevel[L-1] × L; in-between volumes interpolate
 * (see seaShipmentCost in sea-carriers.ts).
 */
export interface SeaCarrierProfile {
  id: string;
  name: string;
  enabled: boolean;
  /** USD cost per CBM at shipment volumes 1..7 CBM (length 7). */
  perCbmByLevel: number[];
}

export interface FactoryPricingConfig {
  shippingOptions: ShippingOption[];
  /**
   * Sea-freight cost profiles, one per forwarder. The active one (see
   * `activeSeaCarrierId`) drives ALL sea pricing — it replaces the legacy flat
   * `ShippingOption.seaRate`. Optional for back-compat: when missing/empty the
   * engine falls back to the flat seaRate of the chosen sea ShippingOption.
   */
  seaCarriers?: SeaCarrierProfile[];
  /** Id of the active SeaCarrierProfile. Falls back to the first enabled one. */
  activeSeaCarrierId?: string;
  /**
   * Assumed shipment volume (CBM) used as the DEFAULT pricing basis for a
   * single order. Small orders (most are 1–3 CBM) are billed at the per-CBM
   * cost evaluated at THIS volume — i.e. as if they ride inside a shipment of
   * this size — so a 1-CBM order isn't punished by the fixed costs it can't
   * amortise alone. Orders larger than this are billed on their own (cheaper)
   * true per-CBM cost. Defaults to 3. See `seaPerOrderUsd` in sea-carriers.ts.
   */
  assumedShipmentCbm?: number;
  /** USD → ILS conversion (factory quotes are CNY → USD → ILS) */
  usdToIls: number;
  /** CNY → USD divisor (i.e. 1 USD = X CNY) */
  usdToCny: number;
  /** ILS → CNY rate. Manual (NOT auto-derived from USD rates) so it can
   *  drift independently when needed. Shown in the boss view of every
   *  quote for cost reference. Optional — falls back to derived value
   *  (usdToCny / usdToIls) when missing. */
  ilsToCny?: number;
  /** When true (default), a daily cron overwrites usdToIls/usdToCny with the
   *  live market rate (see /api/cron/refresh-fx + lib/fx/live-rates.ts). Turn
   *  OFF to freeze the rate manually. */
  fxAutoUpdate?: boolean;
  /** ISO timestamp of the last live-FX write (auto or manual "refresh now"). */
  fxUpdatedAt?: string;
  /** Default profit margin % when caller doesn't override and no per-qty value */
  defaultProfitMargin: number;
  /**
   * Salesperson commission %, applied to the TOTAL sale (gross deal amount).
   * Display-only and boss-only: it never changes the customer price — it just
   * shows the boss what the rep earns and the net profit after commission.
   * Defaults to 10 when missing (back-compat with rows written before this field).
   */
  commissionPct?: number;
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
  /**
   * When true, price sea on this order's OWN volume (true single-shipment cost)
   * instead of the assumed-volume basis. For the boss to flip per-quote on a
   * one-off large order that fills a shipment by itself. Default false.
   */
  seaUseTrueCost?: boolean;
  /** One-time mold/tooling fee from the factory in CNY.
   *  Treated as a SEPARATE one-time line in the quote (not amortized into
   *  per-bag price). The same margin applies to it like any other cost, but
   *  it shows up as its own row in the PDF and as its own "סה״כ מולדים"
   *  total — the per-unit bag price stays mold-free. */
  moldsCostCny?: number;
  /** Plate ("plant") fee per print colour in CNY (from factory sheet
   *  column T). Together with logoColors, it produces a pass-through
   *  cost distributed across the whole order: the customer pays the
   *  exact factory cost per unit, no margin. Same treatment as shipping —
   *  added after margin, visible as a separate per-unit component in
   *  the internal breakdown. */
  platePerColorCny?: number;
  /** Number of print colours (1..N) — needed to compute the plate fee
   *  total. If undefined but platePerColorCny is set, the engine assumes
   *  1 colour. */
  logoColors?: number;
  /** Manual override of the TOTAL shipment CBM (m³). When > 0 it REPLACES the
   *  dimension-derived CBM for the shipping-cost calc — for grouped/consolidated
   *  orders where the real packing volume differs from the naive per-carton sum.
   *  Weight is unaffected (air pricing is weight-based). Optional. */
  totalCbmOverride?: number;
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
  /** Salesperson commission % (echoed from config). Display/boss-only — the
   *  commission is computed from this against totalSellingPrice and never alters
   *  any customer-facing price. Undefined falls back to the default (10). */
  commissionPct?: number;

  // One-time mold/tooling charge — a SEPARATE line item, NOT folded into
  // unitCost / unitSellingPrice / unitProfit. Per-unit numbers are bag-only.
  // Totals (totalCost / totalSellingPrice / totalProfit) ARE grand totals
  // and include the mold one-time amounts below.
  //   moldsTotalCny:   raw factory mold cost in CNY (echo of input)
  //   moldsPerUnitCny: legacy field — moldsTotalCny ÷ quantity. Kept so
  //                    existing internal UIs that displayed it don't break;
  //                    nothing in the pricing math uses it any more.
  //   moldsTotalCostIls:         moldsTotalCny converted to ILS at FX (no margin)
  //   moldsTotalSellingPriceIls: customer's one-time mold charge (with margin)
  //   moldsTotalProfitIls:       sellingPrice − cost on the mold
  moldsTotalCny: number;
  moldsPerUnitCny: number;
  moldsTotalCostIls: number;
  moldsTotalSellingPriceIls: number;
  moldsTotalProfitIls: number;

  // Plate ("plant") fee, pulled from column T of the factory-quote sheet.
  // Pass-through, no margin — the customer pays the exact factory cost,
  // spread per unit like shipping. Present only when the factory quoted a
  // plate fee AND colors > 0.
  //   platePerColorCny:    what the factory quoted per colour (echo)
  //   plateFeeTotalCny:    platePerColorCny × logoColors (grand plate total)
  //   platePerUnitCny:     plateFeeTotalCny ÷ quantity (per unit, ¥)
  //   platePerUnitIls:     platePerUnitCny converted to ILS at FX (no margin)
  //   plateFeeTotalCostIls:plateFeeTotalCny converted to ILS at FX (no margin)
  //   plateFeeLogoColors:  colours used to compute the total (echo)
  platePerColorCny?: number;
  plateFeeTotalCny?: number;
  platePerUnitCny?: number;
  platePerUnitIls?: number;
  plateFeeTotalCostIls?: number;
  plateFeeLogoColors?: number;

  // Split shipment — present only when the operator split the order into an
  // air portion and a sea portion. When set, the customer PDF + WhatsApp caption
  // show the production price on the full quantity plus two shipping lines, and
  // the total is productTotalIls + airIls + seaIls (+ molds). Production side is
  // unchanged; only shipping splits. See ShippingSplit.
  shippingSplit?: ShippingSplit;
}

/** A split shipment: production price stays on the full order; only shipping
 *  splits into an air portion and a sea portion, each priced on its own volume. */
export interface ShippingSplit {
  /** Bag-only selling price per unit (margin included, shipping EXCLUDED). */
  productUnitIls: number;
  /** Production total = productUnitIls × quantity (rounded, excl shipping + molds). */
  productTotalIls: number;
  airIls: number;
  seaIls: number;
  /** e.g. "אקספרס · 1,000 יח׳" */
  airLabel: string;
  /** e.g. "סטנדרט · 9,000 יח׳" */
  seaLabel: string;
}

/**
 * Post-close ACTUAL costs for a WON deal — the reconciliation layer.
 *
 * The customer price is locked once the quote closes, so any gap between what
 * Eli PLANNED (finalPricing) and what actually happened falls on his margin.
 * The two things that drift: the factory sometimes raises the price after
 * close, and real shipping differs from the averaged shipping charged to the
 * customer. Enter the real totals here (default to the planned values) plus any
 * number of free-form other-cost lines; the UI shows planned-vs-actual profit
 * so Eli can tell whether his pricing/averaging is calibrated.
 *
 * All amounts in ILS totals (whole order), to compare directly against
 * finalPricing.totalCost / totalShipping / totalProfit. Stored in its OWN
 * column (factory_quote_requests.actual_costs) so a re-finalize never wipes it.
 */
export interface QuoteActualCosts {
  /** Real factory cost paid, total ₪ (production all-in). Undefined → use planned. */
  factoryTotalIls?: number;
  /** Real shipping paid, total ₪. Undefined → use planned. */
  shippingTotalIls?: number;
  /** What the customer ACTUALLY paid (Zoho invoice total), ₪ — catches post-close
   *  discounts/extras. Undefined → assume the planned totalSellingPrice. */
  actualRevenueIls?: number;
  /** Any extra costs on this order — customs, rework, samples, etc. */
  otherCosts?: { label: string; amountIls: number }[];
  /** Zoho Books documents these actuals were pulled from (link-back + audit). */
  zohoRefs?: ZohoDocRef[];
  /** Free note — e.g. "אוחד עם הזמנה X", "המפעל העלה מחיר". */
  note?: string;
  /** ISO timestamp of the last save. */
  updatedAt?: string;
}

/** Pointer to the Zoho Books document an actual-cost line came from. */
export interface ZohoDocRef {
  type: "invoice" | "bill" | "expense";
  id: string;
  /** Human doc number — INV-000231 / BILL-000118. */
  number?: string;
  amountIls?: number;
  /** Document date, ISO yyyy-mm-dd. */
  date?: string;
  /** Customer (invoice) or vendor (bill/expense) name on the Zoho doc. */
  party?: string;
}

/**
 * Pure helpers for the "detailed boss breakdown" view shared between
 * FinalizeModal, CalculatorView (BreakdownCard), and FactoryQuotePanel
 * (FinalizedState). Turns a FactoryPricingResult (or QuoteResult shaped
 * the same way) plus FX rates + seaRate into the precomputed numbers the
 * UI shows row by row.
 *
 * Keep this UI-agnostic — no JSX, no formatting.
 */

export interface BreakdownInput {
  // Per-unit ILS values from the pricing engine
  unitCost: number; // production only, ILS, no shipping
  unitShipping: number; // ILS, pass-through (no margin)
  unitProfit: number; // ILS
  unitSellingPrice: number; // ILS, includes shipping
  totalCost: number;
  totalShipping: number;
  totalProfit: number;
  totalSellingPrice: number;
  quantity: number;
  profitMarginPct: number;
  totalCartons: number;
  totalWeightKg: number;
  totalCbm: number; // raw, post-Math.max if engine already floored — see floorApplied
  shippingType: "sea" | "air" | null;

  // Factory cost in original CNY (the input ¥ before any conversion)
  // For factory quotes: row.factoryResponse.unitCostCny
  // For calculator quotes: result.unitProductionCny
  factoryUnitCostCny?: number;

  // FX
  usdToIls: number;
  usdToCny: number;

  // Sea floor — we want to display "raw CBM vs effective CBM" even when
  // the engine already applied Math.max(cbm, 1). Caller passes the raw
  // CBM value and the floor; we derive the rest.
  seaRate?: number; // $/CBM
  rawCbm?: number; // unfloored CBM (caller knows; engine result holds the floored one)
  seaMinCbm?: number; // typically 1

  // For plate fee amortization (optional, customer-side QuoteResult exposes it)
  plateFeeCnyPerUnit?: number;

  // Components, only when caller has them (calculator path)
  components?: {
    baseBagCny: number;
    handlesAddonCny: number;
    laminationAddonCny: number;
    plateFeeCny: number;
    logoAddonCny: number;
    moldsPerUnitCny?: number;
  } | null;

  // Air-vs-sea comparison (optional, customer-side has altResult)
  alt?: {
    shippingType: "sea" | "air";
    unitSellingPrice: number;
    totalSellingPrice: number;
    shippingName: string | null;
  } | null;
}

export interface BreakdownView {
  fx: {
    usdToIls: number;
    usdToCny: number;
    cnyToIls: number; // derived = usdToIls / usdToCny
  };
  factory: {
    cnyPerUnit: number | null;
    usdPerUnit: number | null;
    ilsPerUnit: number; // = unitCost
    ilsTotal: number; // = totalCost
  };
  shipping: {
    type: "sea" | "air" | null;
    ilsPerUnit: number;
    ilsTotal: number;
    rate: number | null; // sea: $/CBM, air: undefined
    rawCbm: number | null;
    effectiveCbm: number | null;
    floorApplied: boolean;
    floorImpactUsd: number; // (effective - raw) * rate
    floorImpactIls: number;
    utilizationPct: number | null; // raw / floor
    utilizationLow: boolean; // < 50%
  };
  margin: {
    pct: number;
    ilsPerUnitProfit: number;
    ilsTotalProfit: number;
    pctOfRevenue: number; // totalProfit / totalSellingPrice * 100
    formula: string; // human-readable "₪X × Y% = ₪Z/יח׳"
  };
  totals: {
    unitSellingPrice: number;
    totalSellingPrice: number;
    profitShareOfPriceLabel: string; // "מהמחיר X%"
  };
  components: BreakdownInput["components"];
  plateFee: {
    cnyPerUnit: number;
    ilsPerUnit: number;
    ilsTotal: number;
    quantity: number;
  } | null;
  alt: BreakdownInput["alt"];
  logistics: {
    cartons: number;
    weightKg: number;
    cbm: number;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function buildBreakdownView(input: BreakdownInput): BreakdownView {
  const cnyToIls = input.usdToCny > 0 ? input.usdToIls / input.usdToCny : 0;

  const factoryCny = input.factoryUnitCostCny ?? null;
  const factoryUsd =
    factoryCny !== null && input.usdToCny > 0 ? factoryCny / input.usdToCny : null;

  const rate = input.seaRate ?? null;
  const rawCbm = input.rawCbm ?? null;
  const minCbm = input.seaMinCbm ?? 1;
  const isSea = input.shippingType === "sea";
  const effectiveCbm =
    isSea && rawCbm !== null ? Math.max(rawCbm, minCbm) : rawCbm;
  const floorApplied = isSea && rawCbm !== null && rawCbm < minCbm;
  const floorImpactUsd =
    isSea && floorApplied && rate !== null && effectiveCbm !== null
      ? (effectiveCbm - (rawCbm ?? 0)) * rate
      : 0;
  const utilizationPct =
    isSea && rawCbm !== null && minCbm > 0
      ? Math.min(100, (rawCbm / minCbm) * 100)
      : null;

  const pctOfRevenue =
    input.totalSellingPrice > 0
      ? (input.totalProfit / input.totalSellingPrice) * 100
      : 0;

  return {
    fx: {
      usdToIls: input.usdToIls,
      usdToCny: input.usdToCny,
      cnyToIls: r4(cnyToIls),
    },
    factory: {
      cnyPerUnit: factoryCny !== null ? r3(factoryCny) : null,
      usdPerUnit: factoryUsd !== null ? r4(factoryUsd) : null,
      ilsPerUnit: r2(input.unitCost),
      ilsTotal: r2(input.totalCost),
    },
    shipping: {
      type: input.shippingType,
      ilsPerUnit: r2(input.unitShipping),
      ilsTotal: r2(input.totalShipping),
      rate,
      rawCbm: rawCbm !== null ? r3(rawCbm) : null,
      effectiveCbm: effectiveCbm !== null ? r3(effectiveCbm) : null,
      floorApplied,
      floorImpactUsd: r2(floorImpactUsd),
      floorImpactIls: r2(floorImpactUsd * input.usdToIls),
      utilizationPct: utilizationPct !== null ? r2(utilizationPct) : null,
      utilizationLow: utilizationPct !== null && utilizationPct < 50,
    },
    margin: {
      pct: input.profitMarginPct,
      ilsPerUnitProfit: r2(input.unitProfit),
      ilsTotalProfit: r2(input.totalProfit),
      pctOfRevenue: r2(pctOfRevenue),
      formula: `₪${r2(input.unitCost).toFixed(2)} עלות → ${input.profitMarginPct}% מהמחיר = ₪${r2(input.unitProfit).toFixed(2)}/יח׳ רווח`,
    },
    totals: {
      unitSellingPrice: r2(input.unitSellingPrice),
      totalSellingPrice: r2(input.totalSellingPrice),
      profitShareOfPriceLabel: `${r2(pctOfRevenue).toFixed(1)}% מהמחיר`,
    },
    components: input.components ?? null,
    plateFee:
      input.plateFeeCnyPerUnit && input.plateFeeCnyPerUnit > 0
        ? {
            cnyPerUnit: r3(input.plateFeeCnyPerUnit),
            ilsPerUnit: r3(input.plateFeeCnyPerUnit * cnyToIls),
            ilsTotal: r2(input.plateFeeCnyPerUnit * cnyToIls * input.quantity),
            quantity: input.quantity,
          }
        : null,
    alt: input.alt ?? null,
    logistics: {
      cartons: input.totalCartons,
      weightKg: r2(input.totalWeightKg),
      cbm: r3(input.totalCbm),
    },
  };
}

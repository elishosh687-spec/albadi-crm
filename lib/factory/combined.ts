/**
 * Combined pricing for several products that ship together in ONE shipment.
 *
 * Shipping is a pass-through cost (no margin), and a single shipment is cheaper
 * than shipping each product separately — the sea 1-CBM floor is counted once,
 * and air weight tiers apply to the combined weight. So we recompute shipping
 * on the MERGED volume/weight and pass the saving straight to the customer:
 *   profit is unchanged (it's margin on production), the price just drops.
 *
 * Shared by the FinalizeModal "חישוב משולב" panel and the combined PDF.
 */

import { priceFactoryQuote } from "./pricing";
import {
  getActiveSeaCarrier,
  seaPerOrderUsd,
  DEFAULT_ASSUMED_SHIPMENT_CBM,
} from "./sea-carriers";
import type {
  FactoryPricingConfig,
  FactoryPricingResult,
  FactoryProductSpec,
  FactoryResponse,
  ShippingOption,
} from "./types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default profit margin for a quantity, using the per-qty matrix (snap-down). */
function snapMargin(config: FactoryPricingConfig, qty: number): number {
  const m = config.profitMarginByQuantity;
  if (m && Object.keys(m).length > 0) {
    if (m[String(qty)] !== undefined) return m[String(qty)];
    const keys = Object.keys(m)
      .map(Number)
      .sort((a, b) => a - b);
    let best = keys[0];
    for (const k of keys) if (k <= qty) best = k;
    return m[String(best)] ?? config.defaultProfitMargin;
  }
  return config.defaultProfitMargin;
}

export interface CombinableQuote {
  productSpec: FactoryProductSpec;
  factoryResponse: FactoryResponse | null;
  finalPricing: FactoryPricingResult | null;
}

/** The margin to show by default for a quote in the combined view. */
export function defaultMarginFor(
  q: CombinableQuote,
  config: FactoryPricingConfig
): number {
  if (q.finalPricing) return q.finalPricing.profitMarginPct;
  return snapMargin(config, q.productSpec.quantity);
}

/**
 * Pricing for a quote to feed the combined calc. With `marginOverride` it
 * always re-prices at that margin (so each product's slider drives it). Without
 * it: saved finalPricing if finalized, else priced on the fly with the default
 * margin — so "received" quotes can be combined before they're finalized.
 */
export function priceQuoteForCombine(
  q: CombinableQuote,
  config: FactoryPricingConfig,
  shippingOptionId: string | null,
  marginOverride?: number
): FactoryPricingResult | null {
  if (marginOverride === undefined && q.finalPricing) return q.finalPricing;
  const resp = q.factoryResponse;
  if (!resp) return q.finalPricing ?? null;
  const qty = q.productSpec.quantity;
  const margin =
    marginOverride ?? q.finalPricing?.profitMarginPct ?? snapMargin(config, qty);
  return priceFactoryQuote(
    {
      factoryUnitCostCny: resp.unitCostCny,
      quantity: qty,
      shippingOptionId: shippingOptionId || q.productSpec.shippingOptionId || null,
      cartonSpec: {
        qty: resp.cartonQty,
        weightKg: resp.weightKg,
        cbm: resp.cartonCbm,
        lengthCm: resp.cartonLengthCm,
        widthCm: resp.cartonWidthCm,
        heightCm: resp.cartonHeightCm,
      },
      profitMarginOverride: margin,
      moldsCostCny: 0,
    },
    config
  );
}

/** Total shipping (ILS) for a single shipment of the given CBM + weight.
 *  Sea uses the active carrier profile (same per-order rule as single quotes —
 *  the merged CBM is billed at the assumed-volume basis or its own true cost);
 *  air uses the chosen option's weight tiers. */
export function combinedShippingIls(
  totalCbm: number,
  totalWeightKg: number,
  opt: ShippingOption | null | undefined,
  config: FactoryPricingConfig
): number {
  if (!opt) return 0;
  const usdToIls = config.usdToIls;
  let usd = 0;
  if (opt.type === "sea") {
    const carrier = getActiveSeaCarrier(config);
    if (carrier) {
      usd = seaPerOrderUsd(carrier, totalCbm, {
        assumedCbm: config.assumedShipmentCbm ?? DEFAULT_ASSUMED_SHIPMENT_CBM,
      }).shipmentUsd;
    } else if (opt.seaRate && opt.seaRate > 0) {
      usd = Math.max(totalCbm, 1) * opt.seaRate; // legacy fallback
    }
  } else if (opt.type === "air" && opt.airRates) {
    const r = opt.airRates;
    const rate =
      totalWeightKg <= r.thresholdKg ? r.rateBelowThreshold : r.rateAboveThreshold;
    usd = totalWeightKg * rate;
  }
  return r2(usd * usdToIls);
}

/** Per-product fields needed from each quote's pricing (FactoryPricingResult). */
export interface CombinedItemInput {
  totalCost: number; // production only (ILS), excludes shipping
  totalProfit: number;
  totalSellingPrice: number; // production + profit + its own shipping
  totalShipping: number;
  totalCbm: number;
  totalWeightKg: number;
}

export interface CombinedPricingResult {
  count: number;
  combinedCbm: number;
  combinedWeightKg: number;
  combinedShipping: number; // recomputed, one shipment
  separateShipping: number; // sum of each product's own shipping
  shippingSaving: number; // separate − combined (≥ 0)
  totalProduction: number; // sum of production costs
  totalProfit: number; // unchanged by combining
  productPriceTotal: number; // production + profit (before shipping)
  grandTotal: number; // productPriceTotal + combinedShipping
  separateGrandTotal: number; // sum of each product's totalSellingPrice
  overallMarginPct: number; // profit ÷ product price (margin-on-price)
}

export interface CombinedAllocationSplit {
  airIds: string[];
  airShippingOptionId: string;
  seaShippingOptionId: string;
}

export interface CombinedAllocated {
  perProduct: { id: string; adjusted: FactoryPricingResult }[];
  /** Grand total summed the SAME way the PDF sums its rows: rounded per-unit ×
   *  qty + one-time mold — so the WhatsApp caption and the PDF always agree. */
  grandTotal: number;
  airIls?: number;
  seaIls?: number;
  airName?: string;
  seaName?: string;
}

/**
 * Allocate one (or, when `split` is given, two) merged shipment(s) back to each
 * product by its CBM share, folding shipping into a bag-only per-unit price.
 * Single source of truth for BOTH the combined PDF and the WhatsApp caption so
 * their grand totals reconcile to the shekel.
 */
export function allocateCombined(
  items: { id: string; pricing: FactoryPricingResult }[],
  singleOpt: ShippingOption | null | undefined,
  config: FactoryPricingConfig,
  split?: CombinedAllocationSplit,
  /** Manual override of the merged CBM (m³), single-shipment only. Sets the
   *  shipping amount; per-product share still uses each item's own CBM. */
  cbmOverride?: number
): CombinedAllocated {
  const airSet = new Set(split?.airIds ?? []);
  const air = items.filter((i) => airSet.has(i.id));
  const sea = items.filter((i) => !airSet.has(i.id));
  const isSplit = !!split && air.length > 0 && sea.length > 0;
  const gc = (l: typeof items) => r2(l.reduce((s, i) => s + (i.pricing.totalCbm || 0), 0));
  const gw = (l: typeof items) => r2(l.reduce((s, i) => s + (i.pricing.totalWeightKg || 0), 0));

  let groupOf: (id: string) => { shipping: number; cbm: number; count: number; name: string | null };
  let airIls: number | undefined;
  let seaIls: number | undefined;
  let airName: string | undefined;
  let seaName: string | undefined;

  if (isSplit) {
    const airOpt = config.shippingOptions.find((s) => s.id === split!.airShippingOptionId) ?? null;
    const seaOpt = config.shippingOptions.find((s) => s.id === split!.seaShippingOptionId) ?? null;
    const airCbm = gc(air);
    const seaCbm = gc(sea);
    airIls = combinedShippingIls(airCbm, gw(air), airOpt, config);
    seaIls = combinedShippingIls(seaCbm, gw(sea), seaOpt, config);
    airName = airOpt?.name ?? "אווירי";
    seaName = seaOpt?.name ?? "ימי";
    groupOf = (id) =>
      airSet.has(id)
        ? { shipping: airIls!, cbm: airCbm, count: air.length, name: airOpt?.name ?? null }
        : { shipping: seaIls!, cbm: seaCbm, count: sea.length, name: seaOpt?.name ?? null };
  } else {
    const cbm = gc(items);
    // Override sets the shipping VOLUME; share denominator stays the true summed
    // CBM so per-product allocation still sums to 1.
    const shipCbm = cbmOverride && cbmOverride > 0 ? cbmOverride : cbm;
    const shipping = combinedShippingIls(shipCbm, gw(items), singleOpt, config);
    groupOf = () => ({ shipping, cbm, count: items.length, name: singleOpt?.name ?? null });
  }

  const perProduct = items.map(({ id, pricing: p }) => {
    const g = groupOf(id);
    const share = g.cbm > 0 ? (p.totalCbm || 0) / g.cbm : 1 / g.count;
    const allocShipping = r2(g.shipping * share);
    const mold = p.moldsTotalSellingPriceIls ?? 0;
    const bags = r2(p.totalSellingPrice - p.totalShipping - mold);
    const newBags = r2(bags + allocShipping);
    const newUnit = p.quantity > 0 ? r2(newBags / p.quantity) : newBags;
    const adjusted: FactoryPricingResult = {
      ...p,
      unitShipping: p.quantity > 0 ? r2(allocShipping / p.quantity) : allocShipping,
      totalShipping: allocShipping,
      unitSellingPrice: newUnit, // bag-only — the mold renders as its own row
      totalSellingPrice: r2(newBags + mold),
      shippingOptionName: isSplit ? g.name : p.shippingOptionName,
    };
    return { id, adjusted };
  });

  const grandTotal = r2(
    perProduct.reduce(
      (s, { adjusted: a }) => s + r2(a.unitSellingPrice * a.quantity) + (a.moldsTotalSellingPriceIls ?? 0),
      0
    )
  );
  return { perProduct, grandTotal, airIls, seaIls, airName, seaName };
}

export function computeCombined(
  items: CombinedItemInput[],
  opt: ShippingOption | null | undefined,
  config: FactoryPricingConfig,
  /** Manual override of the merged CBM (m³) — for grouped orders whose real
   *  packing volume differs from the naive sum. When > 0 it replaces the summed
   *  CBM in the shipping calc (weight is unaffected). */
  cbmOverride?: number
): CombinedPricingResult {
  const sum = (f: (i: CombinedItemInput) => number) =>
    items.reduce((s, i) => s + (f(i) || 0), 0);

  const combinedCbm =
    cbmOverride && cbmOverride > 0 ? r2(cbmOverride) : r2(sum((i) => i.totalCbm));
  const combinedWeightKg = r2(sum((i) => i.totalWeightKg));
  const combinedShipping = combinedShippingIls(
    combinedCbm,
    combinedWeightKg,
    opt,
    config
  );
  const separateShipping = r2(sum((i) => i.totalShipping));
  const totalProduction = r2(sum((i) => i.totalCost));
  const totalProfit = r2(sum((i) => i.totalProfit));
  const productPriceTotal = r2(totalProduction + totalProfit);
  const grandTotal = r2(productPriceTotal + combinedShipping);

  return {
    count: items.length,
    combinedCbm,
    combinedWeightKg,
    combinedShipping,
    separateShipping,
    shippingSaving: r2(separateShipping - combinedShipping),
    totalProduction,
    totalProfit,
    productPriceTotal,
    grandTotal,
    separateGrandTotal: r2(sum((i) => i.totalSellingPrice)),
    overallMarginPct:
      productPriceTotal > 0 ? Math.round((totalProfit / productPriceTotal) * 1000) / 10 : 0,
  };
}

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
import { customerTotalExVat } from "./customer-total";
import { ceilAgorot } from "./rounding";
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

/**
 * A quote's selling price INCLUDING its own shipping but EXCLUDING the one-time
 * molds — the base the merged-shipment allocation re-prices.
 *
 * It has to detect the convention, because the codebase stores `totalSellingPrice`
 * two contradictory ways: the engine documents it as a GRAND total (bags + mold,
 * pricing.ts), while a saved DRAFT writes it BAGS-ONLY (to-pricing.ts). Blindly
 * subtracting the mold removed it twice from every draft — on Asaf Grinshpan that
 * quietly cut ₪451.70 off a combined offer and showed up as a ₪400 "saving"
 * (Eli 2026-08-02: "עיגול זה עדיין לא חיסכון").
 *
 * `unitSellingPrice × qty` is bags+shipping by definition in both conventions, so
 * it is the reference that tells the two apart.
 */
function bagsInclShipping(p: FactoryPricingResult): number {
  const mold = p.moldsTotalSellingPriceIls ?? 0;
  const gross = p.totalSellingPrice ?? 0;
  if (mold <= 0) return gross;
  const ref = (p.unitSellingPrice ?? 0) * (p.quantity ?? 0);
  const includesMold = Math.abs(gross - mold - ref) <= Math.abs(gross - ref);
  return includesMold ? gross - mold : gross;
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
    // Merging may only ever HELP the customer. The merged shipment is repriced at
    // today's rates while each quote carries the freight frozen when it was made,
    // so a stale-vs-fresh gap could make the combined offer cost MORE than the two
    // separate quotes already in the customer's hands — ₪100 on Asaf Grinshpan
    // (Eli 2026-08-02: "איך הגיוני שההצעה המשולבת תהיה יותר גבוהה?"). Cap it at
    // what they are already paying separately; a real merge saving still flows.
    const ownShipping = r2(items.reduce((s, i) => s + (i.pricing.totalShipping || 0), 0));
    const merged = combinedShippingIls(shipCbm, gw(items), singleOpt, config);
    const shipping = cbmOverride && cbmOverride > 0 ? merged : Math.min(merged, ownShipping);
    groupOf = () => ({ shipping, cbm, count: items.length, name: singleOpt?.name ?? null });
  }

  const perProduct = items.map(({ id, pricing: p }) => {
    const g = groupOf(id);
    const share = g.cbm > 0 ? (p.totalCbm || 0) / g.cbm : 1 / g.count;
    const allocShipping = r2(g.shipping * share);
    const mold = p.moldsTotalSellingPriceIls ?? 0;
    const bags = r2(bagsInclShipping(p) - p.totalShipping);
    const newBags = r2(bags + allocShipping);
    const newUnit = p.quantity > 0 ? ceilAgorot(newBags / p.quantity) : newBags;
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

  const sumCustomer = (list: { adjusted: FactoryPricingResult }[]) =>
    r2(
      list.reduce(
        (s, { adjusted: a }) => s + r2(a.unitSellingPrice * a.quantity) + (a.moldsTotalSellingPriceIls ?? 0),
        0
      )
    );
  const grandTotal = sumCustomer(perProduct);

  // THE INVARIANT: a combined offer never costs more than the quotes it merges.
  // Even with the merged freight capped, redistributing it by CBM share hands the
  // bulkier product more freight than it carried alone, and rounding that up to
  // the agora can lift the total (Asaf Grinshpan: +₪50 —
  // Eli 2026-08-02 "איך הגיוני שההצעה המשולבת תהיה יותר גבוהה?"). When merging
  // doesn't actually produce a lower price, the customer simply keeps the prices
  // he was already quoted. Skipped when the operator deliberately shaped the
  // shipment (split legs or a manual merged CBM) — there the change is intended.
  const untouched = items.map(({ id, pricing }) => ({ id, adjusted: pricing }));
  if (!isSplit && !(cbmOverride && cbmOverride > 0)) {
    const separateTotal = sumCustomer(untouched);
    if (grandTotal >= separateTotal) {
      return { perProduct: untouched, grandTotal: separateTotal, airIls, seaIls, airName, seaName };
    }
  }
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
  const mergedShipping = combinedShippingIls(
    combinedCbm,
    combinedWeightKg,
    opt,
    config
  );
  // Same cap as allocateCombined: merging can only help the customer.
  const ownShippingTotal = r2(sum((i) => i.totalShipping));
  const combinedShipping =
    cbmOverride && cbmOverride > 0 ? mergedShipping : Math.min(mergedShipping, ownShippingTotal);
  // Each item priced as its OWN shipment at TODAY's rates — not the sum of the
  // figures frozen in the quotes. Comparing stored-then against computed-now made
  // merging look like it COST money (Asaf Grinshpan: −₪54.76, which is an FX/rate
  // drift between old quotes and the current config, not a real merge penalty).
  // Eli 2026-08-02: "אבל אין זה הגיוני שיהיה מינוס?" — correct, so both sides of
  // the comparison are now computed the same way, at the same moment.
  const separateShipping = r2(
    items.reduce(
      (s, i) => s + combinedShippingIls(i.totalCbm, i.totalWeightKg, opt, config),
      0
    )
  );
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
    // Compared like-for-like with grandTotal: BOTH sides priced the way the
    // customer is actually quoted (rounded per-bag × qty + molds). Reading the
    // engine's exact totalSellingPrice here while the combined side rounded per
    // bag made the comparison manufacture a "saving" out of pure rounding —
    // ₪400 on Asaf Grinshpan with zero freight benefit (Eli 2026-08-02:
    // "עיגול זה עדיין לא חיסכון... אני חייב סטנדרט יחיד לכל המערכת").
    separateGrandTotal: r2(sum((i) => customerTotalExVat(i) ?? i.totalSellingPrice)),
    overallMarginPct:
      productPriceTotal > 0 ? Math.round((totalProfit / productPriceTotal) * 1000) / 10 : 0,
  };
}

/**
 * The shipping option to price the MERGED shipment on.
 *
 * `combinedShippingIls` returns 0 for a null option, so a caller that derived it
 * from `items[0].pricing.shippingOptionId` and came up empty would quote a
 * combined offer with NO shipping at all. That is exactly what happens with
 * self-priced DRAFTS, whose snapshot often carries no shippingOptionId — on
 * Asaf Grinshpan's two drafts it turned a real ~₪8.8k offer into ₪5.8k
 * (Eli 2026-08-02). So: first member that names one, else the first enabled
 * option in config, else null (and the caller must refuse rather than ship free).
 */
export function resolveMergedShippingOption(
  items: { pricing: FactoryPricingResult }[],
  config: FactoryPricingConfig
): ShippingOption | null {
  for (const it of items) {
    const id = it.pricing?.shippingOptionId;
    if (!id) continue;
    const opt = config.shippingOptions.find((s) => s.id === id);
    if (opt) return opt;
  }
  return config.shippingOptions.find((s) => s.enabled) ?? null;
}

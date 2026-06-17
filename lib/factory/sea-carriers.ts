/**
 * Sea-freight cost engine — multi-forwarder.
 *
 * Replaces the old flat `seaRate × CBM` model. Each forwarder is a
 * `SeaCarrierProfile` (config.seaCarriers); the active one drives all sea
 * pricing. A shipment's cost is the SUM of the profile's line items evaluated
 * for the shipment's CBM — some flat, some stepped by CBM band, one linear
 * per CBM. Mirrors the "ידים לוגיסטיקה" pricing sheet 1:1.
 *
 * Two ways the cost is consumed:
 *   1. Per-order default pricing (`seaPerOrderUsd`): small orders are billed at
 *      the per-CBM cost evaluated at the ASSUMED shipment volume (default 3 CBM)
 *      — the boss's bet that orders accumulate to fill a shipment. Orders bigger
 *      than that fall back to their own (cheaper) true per-CBM cost.
 *   2. Consolidation planning (`seaShipmentCostUsd`): the true cost of an actual
 *      merged shipment of N CBM — used by the consolidation tool.
 */

import type {
  CbmTier,
  FactoryPricingConfig,
  SeaCarrierProfile,
} from "./types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default assumed shipment volume (CBM) for per-order pricing. */
export const DEFAULT_ASSUMED_SHIPMENT_CBM = 3;

/**
 * The "ידים לוגיסטיקה" forwarder, transcribed verbatim from the pricing sheet
 * (tab "מחירון Yeadim"). Bands: ≤1 / 1–3 / 3–7 CBM. fx 2.9 ₪/$.
 */
export const YEADIM_CARRIER: SeaCarrierProfile = {
  id: "yeadim",
  name: "ידים לוגיסטיקה",
  enabled: true,
  fxUsdToIls: 2.9,
  // USD components
  chinaInlandTiers: [
    { maxCbm: 1, value: 50 },
    { maxCbm: 3, value: 80 },
    { maxCbm: 7, value: 140 },
  ],
  brokerUsd: 100,
  customsUsd: 50,
  lclPerCbmUsd: 175,
  terminalTiers: [
    { maxCbm: 1, value: 180 },
    { maxCbm: 3, value: 250 },
    { maxCbm: 7, value: 350 },
  ],
  // ILS components
  reshumonIls: 80,
  inlandCenterTiers: [
    { maxCbm: 3, value: 300 },
    { maxCbm: 7, value: 480 },
  ],
  inlandNorthTiers: [
    { maxCbm: 3, value: 550 },
    { maxCbm: 7, value: 700 },
  ],
  extraStopIls: 150,
};

/**
 * Pick the value of a stepped component for a given CBM: the first band whose
 * `maxCbm >= cbm`, falling back to the last (highest) band for volumes above
 * every band. Empty tiers → 0.
 */
export function tierValue(tiers: CbmTier[], cbm: number): number {
  if (!tiers || tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.maxCbm - b.maxCbm);
  for (const t of sorted) {
    if (cbm <= t.maxCbm) return t.value;
  }
  return sorted[sorted.length - 1].value;
}

export interface SeaCostBreakdown {
  cbm: number;
  region: "center" | "north";
  extraStops: number;
  // each line in USD (ILS components already converted at the carrier fx)
  chinaInlandUsd: number;
  brokerUsd: number;
  customsUsd: number;
  lclUsd: number;
  terminalUsd: number;
  reshumonUsd: number;
  inlandUsd: number;
  extraStopsUsd: number;
  /** grand total for the whole shipment, USD */
  totalUsd: number;
  /** total ÷ cbm, USD per CBM at this volume */
  perCbmUsd: number;
}

export interface SeaCostOptions {
  region?: "center" | "north";
  extraStops?: number;
}

/**
 * True cost of a single sea shipment of `cbm` cubic metres with this carrier.
 * This is the authoritative cost function — everything else derives from it.
 */
export function seaShipmentCost(
  carrier: SeaCarrierProfile,
  cbm: number,
  opts?: SeaCostOptions
): SeaCostBreakdown {
  const region = opts?.region ?? "center";
  const extraStops = Math.max(0, Math.floor(opts?.extraStops ?? 0));
  const fx = carrier.fxUsdToIls > 0 ? carrier.fxUsdToIls : 1;
  const v = Math.max(cbm, 0);

  const chinaInlandUsd = tierValue(carrier.chinaInlandTiers, v);
  const brokerUsd = carrier.brokerUsd || 0;
  const customsUsd = carrier.customsUsd || 0;
  const lclUsd = (carrier.lclPerCbmUsd || 0) * v;
  const terminalUsd = tierValue(carrier.terminalTiers, v);

  const reshumonIls = carrier.reshumonIls || 0;
  const inlandIls = tierValue(
    region === "north" ? carrier.inlandNorthTiers : carrier.inlandCenterTiers,
    v
  );
  const extraStopsIls = (carrier.extraStopIls || 0) * extraStops;

  const reshumonUsd = reshumonIls / fx;
  const inlandUsd = inlandIls / fx;
  const extraStopsUsd = extraStopsIls / fx;

  const totalUsd =
    chinaInlandUsd +
    brokerUsd +
    customsUsd +
    lclUsd +
    terminalUsd +
    reshumonUsd +
    inlandUsd +
    extraStopsUsd;

  return {
    cbm: v,
    region,
    extraStops,
    chinaInlandUsd: r2(chinaInlandUsd),
    brokerUsd: r2(brokerUsd),
    customsUsd: r2(customsUsd),
    lclUsd: r2(lclUsd),
    terminalUsd: r2(terminalUsd),
    reshumonUsd: r2(reshumonUsd),
    inlandUsd: r2(inlandUsd),
    extraStopsUsd: r2(extraStopsUsd),
    totalUsd: r2(totalUsd),
    perCbmUsd: v > 0 ? r2(totalUsd / v) : 0,
  };
}

export interface SeaPerOrderResult {
  /** USD billed to THIS order for sea freight */
  shipmentUsd: number;
  /** the CBM the per-CBM rate was evaluated at (max(orderCbm, assumed) unless true-cost) */
  billingCbm: number;
  /** per-CBM rate applied */
  perCbmUsd: number;
  /** true raw CBM of this order */
  orderCbm: number;
  /** whether the assumed-volume basis was used (false = order's own true cost) */
  assumedBasisUsed: boolean;
  /** breakdown of the shipment the per-CBM rate was derived from */
  breakdown: SeaCostBreakdown;
}

/**
 * Sea cost to bill a SINGLE order, per the default pricing rule:
 *   billingCbm = useTrueCost ? orderCbm : max(orderCbm, assumedCbm)
 *   perCbm     = seaShipmentCost(carrier, billingCbm) / billingCbm
 *   shipmentUsd = orderCbm × perCbm
 *
 * Net effect: orders below the assumed volume are billed at the (higher) per-CBM
 * rate of the assumed shipment — the boss's 3-CBM bet — while orders at/above it
 * pay their own true cost, which is the same or cheaper per CBM.
 */
export function seaPerOrderUsd(
  carrier: SeaCarrierProfile,
  orderCbm: number,
  opts?: SeaCostOptions & { assumedCbm?: number; useTrueCost?: boolean }
): SeaPerOrderResult {
  const assumedCbm = Math.max(opts?.assumedCbm ?? DEFAULT_ASSUMED_SHIPMENT_CBM, 0);
  const raw = Math.max(orderCbm, 0);
  const useTrueCost = opts?.useTrueCost ?? false;
  const billingCbm = useTrueCost ? Math.max(raw, 0.0001) : Math.max(raw, assumedCbm);
  const breakdown = seaShipmentCost(carrier, billingCbm, opts);
  const perCbmUsd = billingCbm > 0 ? breakdown.totalUsd / billingCbm : 0;
  return {
    shipmentUsd: r2(raw * perCbmUsd),
    billingCbm: r2(billingCbm),
    perCbmUsd: r2(perCbmUsd),
    orderCbm: r2(raw),
    assumedBasisUsed: !useTrueCost && raw < assumedCbm,
    breakdown,
  };
}

export interface ConsolidationItem {
  /** opaque id of the order/quote (for the UI) */
  id: string;
  cbm: number;
}

export interface ConsolidationResult {
  count: number;
  combinedCbm: number;
  /** sum of each item shipped ALONE at its own true cost */
  soloTotalUsd: number;
  /** true cost of the single merged shipment */
  combinedUsd: number;
  /** soloTotal − combined (the consolidation saving, ≥ 0) */
  savingUsd: number;
  combinedPerCbmUsd: number;
  /** per-item solo breakdown, same order as input */
  perItem: { id: string; cbm: number; soloUsd: number }[];
  /** the merged shipment's component breakdown */
  breakdown: SeaCostBreakdown;
  /** band-edge guidance for the combined volume */
  recommendation: {
    /** nearest optimal band edge to aim for (e.g. 3 or 7) */
    targetCbm: number;
    /** extra CBM needed to reach targetCbm (0 if already at/above) */
    addCbm: number;
    /** human Hebrew hint */
    text: string;
  };
}

/** Optimal band edges for the Yeadim-style stepped pricing (top of each band). */
const BAND_EDGES = [3, 7];

/**
 * Plan a consolidated shipment: compare shipping every item ALONE (true cost)
 * vs merging them into one shipment, and advise which band edge to aim for.
 * Pure — drives the consolidation planning screen.
 */
export function consolidateShipment(
  carrier: SeaCarrierProfile,
  items: ConsolidationItem[],
  opts?: SeaCostOptions
): ConsolidationResult {
  const perItem = items.map((it) => ({
    id: it.id,
    cbm: r2(Math.max(it.cbm, 0)),
    soloUsd: seaShipmentCost(carrier, it.cbm, opts).totalUsd,
  }));
  const soloTotalUsd = perItem.reduce((s, i) => s + i.soloUsd, 0);
  const combinedCbm = r2(perItem.reduce((s, i) => s + i.cbm, 0));
  const breakdown = seaShipmentCost(carrier, combinedCbm, opts);
  const combinedUsd = breakdown.totalUsd;

  // Recommendation: aim for the next band edge ≥ current volume (or the top
  // edge once past it). Filling to an edge amortises the stepped costs best.
  let targetCbm = BAND_EDGES.find((e) => combinedCbm <= e) ?? combinedCbm;
  if (combinedCbm > BAND_EDGES[BAND_EDGES.length - 1]) {
    targetCbm = Math.ceil(combinedCbm); // above the table — already large
  }
  const addCbm = r2(Math.max(0, targetCbm - combinedCbm));
  const atEdge = BAND_EDGES.includes(r2(combinedCbm));
  let text: string;
  if (atEdge) {
    text = `אתה בדיוק על ${combinedCbm} קוב — קצה מדרגה מושלם. שלח עכשיו.`;
  } else if (combinedCbm > BAND_EDGES[BAND_EDGES.length - 1]) {
    text = `${combinedCbm} קוב — מעל הטבלה, נצילות טובה. אפשר לשלח.`;
  } else {
    const perNow = breakdown.perCbmUsd;
    const perTarget = targetCbm > 0 ? seaShipmentCost(carrier, targetCbm, opts).perCbmUsd : perNow;
    text = `${combinedCbm} קוב → $${perNow.toFixed(0)}/קוב. הוסף ${addCbm} קוב כדי להגיע ל-${targetCbm} קוב ($${perTarget.toFixed(0)}/קוב).`;
  }

  return {
    count: items.length,
    combinedCbm,
    soloTotalUsd: r2(soloTotalUsd),
    combinedUsd: r2(combinedUsd),
    savingUsd: r2(soloTotalUsd - combinedUsd),
    combinedPerCbmUsd: breakdown.perCbmUsd,
    perItem,
    breakdown,
    recommendation: { targetCbm, addCbm, text },
  };
}

/** The active sea carrier for a config, or null when none is configured. */
export function getActiveSeaCarrier(
  config: FactoryPricingConfig
): SeaCarrierProfile | null {
  const list = config.seaCarriers;
  if (!list || list.length === 0) return null;
  const byId = config.activeSeaCarrierId
    ? list.find((c) => c.id === config.activeSeaCarrierId && c.enabled !== false)
    : null;
  if (byId) return byId;
  return list.find((c) => c.enabled !== false) ?? null;
}

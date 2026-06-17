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

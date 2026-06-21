/**
 * Sea-freight cost engine — multi-forwarder, SIMPLIFIED.
 *
 * A carrier is just its bottom-line cost-per-CBM at shipment volumes 1..7 CBM
 * (the "עלות לקוב" row of its pricing sheet) — no component breakdown. The
 * active carrier drives all sea pricing. Switching/adding a forwarder = type
 * its 7 numbers.
 *
 * Two consumers:
 *   1. Per-order default pricing (`seaPerOrderUsd`): small orders billed at the
 *      per-CBM cost evaluated at the ASSUMED shipment volume (default 3 CBM) —
 *      the boss's bet that orders accumulate. Orders bigger than that fall back
 *      to their own (cheaper) true per-CBM cost.
 *   2. Consolidation planning (`seaShipmentCost` / `consolidateShipment`): the
 *      true cost of an actual merged shipment of N CBM.
 */

import type { SeaCarrierProfile } from "./types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default assumed shipment volume (CBM) for per-order pricing. */
export const DEFAULT_ASSUMED_SHIPMENT_CBM = 3;

/** Highest volume level a carrier table covers. */
export const MAX_CBM_LEVEL = 7;

/**
 * Volume (CBM) above which an order enters consolidation / full-container
 * territory, where real sea-freight cost drops sharply and Eli can negotiate
 * a better rate (and possibly lower the customer's price). This is an
 * INTERNAL, operator-only signal — it never surfaces to the customer.
 */
export const CBM_CONSOLIDATION_THRESHOLD = MAX_CBM_LEVEL; // 7

export function isOverCbmConsolidationThreshold(totalCbm: number): boolean {
  return totalCbm > CBM_CONSOLIDATION_THRESHOLD;
}

/** Canonical operator-facing alert text for the >7 CBM consolidation signal. */
export function cbmConsolidationAlert(totalCbm: number): string {
  return `נפח ${totalCbm.toFixed(2)} קוב — מעל ${CBM_CONSOLIDATION_THRESHOLD} קוב. עלות השילוח יורדת משמעותית (קונסולידציה/מכולה) — שקול לעדכן את ההצעה ללקוח.`;
}

/**
 * The "ידים לוגיסטיקה" forwarder — cost per CBM at 1..7 CBM, taken straight
 * from the "עלות לקוב $" row of its sheet (center, one stop).
 *   1→686  2→481  3→379  4→383  5→342  6→314  7→294
 */
export const YEADIM_CARRIER: SeaCarrierProfile = {
  id: "yeadim",
  name: "ידים לוגיסטיקה",
  enabled: true,
  perCbmByLevel: [686, 481, 379, 383, 342, 314, 294],
};

/** Total USD cost for a shipment of `cbm` with this carrier.
 *  Integer level L → perCbmByLevel[L-1] × L. Fractional → linear interpolation
 *  of the two surrounding levels. Below 1 / above the table → nearest level's
 *  per-CBM rate × cbm. */
export function seaTotalUsd(carrier: SeaCarrierProfile, cbm: number): number {
  const lv = carrier.perCbmByLevel ?? [];
  const max = lv.length;
  const v = Math.max(cbm, 0);
  if (v === 0 || max === 0) return 0;

  const totalAtLevel = (i: number) => (lv[i - 1] ?? lv[lv.length - 1] ?? 0) * i;

  if (v <= 1) return lv[0] * v;
  if (v >= max) return lv[max - 1] * v; // extrapolate at the cheapest top rate

  const lo = Math.floor(v);
  const hi = Math.ceil(v);
  if (lo === hi) return totalAtLevel(lo);
  const tLo = totalAtLevel(lo);
  const tHi = totalAtLevel(hi);
  return tLo + (tHi - tLo) * (v - lo);
}

/** Cost per CBM at a given shipment volume. */
export function seaPerCbmAt(carrier: SeaCarrierProfile, cbm: number): number {
  const v = Math.max(cbm, 0);
  return v > 0 ? seaTotalUsd(carrier, v) / v : 0;
}

export interface SeaCost {
  cbm: number;
  totalUsd: number;
  perCbmUsd: number;
}

/** True cost of a single sea shipment of `cbm` CBM. */
export function seaShipmentCost(
  carrier: SeaCarrierProfile,
  cbm: number
): SeaCost {
  const v = Math.max(cbm, 0);
  const totalUsd = seaTotalUsd(carrier, v);
  return { cbm: r2(v), totalUsd: r2(totalUsd), perCbmUsd: v > 0 ? r2(totalUsd / v) : 0 };
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
}

/**
 * Sea cost to bill a SINGLE order:
 *   billingCbm = useTrueCost ? orderCbm : max(orderCbm, assumedCbm)
 *   shipmentUsd = orderCbm × perCbmAt(billingCbm)
 * Small orders pay the assumed-volume (default 3 CBM) per-CBM rate; orders at or
 * above it pay their own (same/cheaper) true cost.
 */
export function seaPerOrderUsd(
  carrier: SeaCarrierProfile,
  orderCbm: number,
  opts?: { assumedCbm?: number; useTrueCost?: boolean }
): SeaPerOrderResult {
  const assumedCbm = Math.max(opts?.assumedCbm ?? DEFAULT_ASSUMED_SHIPMENT_CBM, 0);
  const raw = Math.max(orderCbm, 0);
  const useTrueCost = opts?.useTrueCost ?? false;
  const billingCbm = useTrueCost ? Math.max(raw, 0.0001) : Math.max(raw, assumedCbm);
  const perCbmUsd = seaPerCbmAt(carrier, billingCbm);
  return {
    shipmentUsd: r2(raw * perCbmUsd),
    billingCbm: r2(billingCbm),
    perCbmUsd: r2(perCbmUsd),
    orderCbm: r2(raw),
    assumedBasisUsed: !useTrueCost && raw < assumedCbm,
  };
}

export interface ConsolidationItem {
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
  perItem: { id: string; cbm: number; soloUsd: number }[];
  recommendation: { targetCbm: number; addCbm: number; text: string };
}

/** Optimal band edges (top of each pricing band) to aim a shipment at. */
const BAND_EDGES = [3, 7];

/**
 * Plan a consolidated shipment: compare shipping every item ALONE (true cost)
 * vs merging them into one shipment, and advise which band edge to aim for.
 */
export function consolidateShipment(
  carrier: SeaCarrierProfile,
  items: ConsolidationItem[]
): ConsolidationResult {
  const perItem = items.map((it) => ({
    id: it.id,
    cbm: r2(Math.max(it.cbm, 0)),
    soloUsd: seaShipmentCost(carrier, it.cbm).totalUsd,
  }));
  const soloTotalUsd = perItem.reduce((s, i) => s + i.soloUsd, 0);
  const combinedCbm = r2(perItem.reduce((s, i) => s + i.cbm, 0));
  const merged = seaShipmentCost(carrier, combinedCbm);

  let targetCbm = BAND_EDGES.find((e) => combinedCbm <= e) ?? combinedCbm;
  if (combinedCbm > BAND_EDGES[BAND_EDGES.length - 1]) targetCbm = Math.ceil(combinedCbm);
  const addCbm = r2(Math.max(0, targetCbm - combinedCbm));
  const atEdge = BAND_EDGES.includes(r2(combinedCbm));
  let text: string;
  if (atEdge) {
    text = `אתה בדיוק על ${combinedCbm} קוב — קצה מדרגה מושלם. שלח עכשיו.`;
  } else if (combinedCbm > BAND_EDGES[BAND_EDGES.length - 1]) {
    text = `${combinedCbm} קוב — מעל הטבלה, נצילות טובה. אפשר לשלח.`;
  } else {
    const perTarget = seaPerCbmAt(carrier, targetCbm);
    text = `${combinedCbm} קוב → $${merged.perCbmUsd.toFixed(0)}/קוב. הוסף ${addCbm} קוב כדי להגיע ל-${targetCbm} קוב ($${perTarget.toFixed(0)}/קוב).`;
  }

  return {
    count: items.length,
    combinedCbm,
    soloTotalUsd: r2(soloTotalUsd),
    combinedUsd: merged.totalUsd,
    savingUsd: r2(soloTotalUsd - merged.totalUsd),
    combinedPerCbmUsd: merged.perCbmUsd,
    perItem,
    recommendation: { targetCbm, addCbm, text },
  };
}

/** The active sea carrier for a config, or null when none is configured.
 *  Accepts any object carrying the two carrier fields (FactoryPricingConfig or
 *  the calculator's AppConfig). */
export function getActiveSeaCarrier(
  config: { seaCarriers?: SeaCarrierProfile[]; activeSeaCarrierId?: string }
): SeaCarrierProfile | null {
  const list = config.seaCarriers;
  if (!list || list.length === 0) return null;
  const byId = config.activeSeaCarrierId
    ? list.find((c) => c.id === config.activeSeaCarrierId && c.enabled !== false)
    : null;
  if (byId) return byId;
  return list.find((c) => c.enabled !== false) ?? null;
}

/** True when a carrier profile uses the new simplified per-CBM shape. */
export function isSimplifiedCarrier(c: unknown): c is SeaCarrierProfile {
  return (
    !!c &&
    typeof c === "object" &&
    Array.isArray((c as SeaCarrierProfile).perCbmByLevel)
  );
}

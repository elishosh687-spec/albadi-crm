/**
 * Apply a shipping SPLIT (part air, part sea) to a single-method pricing result.
 * Production + profit are unchanged (shipping is pass-through, no margin); only
 * shipping and the grand total move. Attaches `shippingSplit` so the boss
 * breakdown, the customer PDF, and the WhatsApp caption all render the two
 * shipping lines and the split total.
 *
 * Single source of truth shared by:
 *   - server finalize ([lib/factory/server/finalize.ts]) — the official quote,
 *   - client live preview (FinalizeModal / CalculatorView) — so preview ==
 *     finalized.
 *
 * Pure + client-safe (no env, no I/O). Caller supplies the already-computed
 * air/sea shipment costs (each priced on its OWN portion's cartons/CBM).
 */
import { ceilAgorot } from "@/lib/factory/rounding";
import type { FactoryPricingResult, ShippingSplit } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Units on a leg — stored since 2026-07-28, parsed out of the label for older
 *  quotes ("אקספרס · 500 יח׳" → 500). */
function legQuantity(explicit: number | undefined, label: string): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const m = label.match(/([\d,]+)\s*יח/);
  const n = m ? parseInt(m[1].replace(/,/g, ""), 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface SplitCustomerLeg {
  label: string;
  quantity: number;
  /** All-in price per bag on this leg: production + THIS leg's shipping. */
  unitIls: number;
  /** unitIls × quantity — derived from the ROUNDED unit so the customer's own
   *  multiplication reconciles with the line total. */
  totalIls: number;
}

export interface SplitCustomerView {
  air: SplitCustomerLeg;
  sea: SplitCustomerLeg;
  moldsIls: number;
  /** air.totalIls + sea.totalIls + molds — reconciles with the printed lines. */
  grandTotalIls: number;
}

/**
 * The CUSTOMER-facing view of a split shipment (Eli 2026-07-28): ONE all-in
 * price per bag for each shipping method, instead of a production line plus two
 * lump shipping charges. "500 יח׳ אווירי × ₪3.03" is what he wants a customer to
 * read.
 *
 * Per the house rounding rule (see `customerRoundedTotalIls`), each leg's unit
 * price is rounded to agorot FIRST and the line total derived from it, so the
 * customer multiplying what they see always lands on the printed total. That
 * makes the grand total differ by a few agorot from `pricing.totalSellingPrice`
 * (which multiplies the unrounded unit) — the printed arithmetic wins.
 *
 * Shared by the WhatsApp captions, the PDF and the widget preview so the four
 * surfaces can never drift apart again.
 */
export function splitCustomerView(split: ShippingSplit, moldsIls = 0): SplitCustomerView {
  const airQty = legQuantity(split.airQuantity, split.airLabel);
  const seaQty = legQuantity(split.seaQuantity, split.seaLabel);
  // Per-leg customer price — rounded UP like every other per-bag price.
  const airUnit = ceilAgorot(split.productUnitIls + (airQty > 0 ? split.airIls / airQty : 0));
  const seaUnit = ceilAgorot(split.productUnitIls + (seaQty > 0 ? split.seaIls / seaQty : 0));
  const airTotal = r2(airUnit * airQty);
  const seaTotal = r2(seaUnit * seaQty);
  const molds = moldsIls > 0 ? r2(moldsIls) : 0;
  return {
    air: { label: split.airLabel, quantity: airQty, unitIls: airUnit, totalIls: airTotal },
    sea: { label: split.seaLabel, quantity: seaQty, unitIls: seaUnit, totalIls: seaTotal },
    moldsIls: molds,
    grandTotalIls: r2(airTotal + seaTotal + molds),
  };
}

export function applyShippingSplit(
  pricing: FactoryPricingResult,
  args: {
    quantity: number;
    airQuantity: number;
    seaQuantity: number;
    airIls: number;
    seaIls: number;
    airName: string;
    seaName: string;
    /** Real per-leg cargo, when the caller priced each leg separately. */
    airCbm?: number;
    airWeightKg?: number;
    airCartons?: number;
    airChargeableKg?: number;
    seaCbm?: number;
    seaWeightKg?: number;
    seaCartons?: number;
  }
): FactoryPricingResult {
  const { quantity } = args;
  const productUnitIls = r2(pricing.unitSellingPrice - pricing.unitShipping);
  const productTotalIls = r2(productUnitIls * quantity);
  const molds = pricing.moldsTotalSellingPriceIls ?? 0;
  const totalShipping = r2(args.airIls + args.seaIls);
  const unitShipping = quantity > 0 ? r2(totalShipping / quantity) : pricing.unitShipping;

  const shippingSplit: ShippingSplit = {
    productUnitIls,
    productTotalIls,
    airIls: r2(args.airIls),
    seaIls: r2(args.seaIls),
    airLabel: `${args.airName || "אווירי"} · ${args.airQuantity.toLocaleString("he-IL")} יח׳`,
    seaLabel: `${args.seaName || "ימי"} · ${args.seaQuantity.toLocaleString("he-IL")} יח׳`,
    airQuantity: args.airQuantity,
    seaQuantity: args.seaQuantity,
    airCbm: args.airCbm,
    airWeightKg: args.airWeightKg,
    airCartons: args.airCartons,
    airChargeableKg: args.airChargeableKg,
    seaCbm: args.seaCbm,
    seaWeightKg: args.seaWeightKg,
    seaCartons: args.seaCartons,
  };

  return {
    ...pricing,
    totalShipping,
    unitShipping,
    unitSellingPrice: r2(productUnitIls + unitShipping),
    totalSellingPrice: r2(productTotalIls + args.airIls + args.seaIls + (molds > 0 ? r2(molds) : 0)),
    shippingSplit,
  };
}

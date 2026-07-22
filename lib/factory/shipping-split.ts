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
import type { FactoryPricingResult, ShippingSplit } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

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

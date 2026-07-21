/**
 * Salesperson commission — DISPLAY-ONLY, BOSS-ONLY.
 *
 * The commission is a flat % of the deal amount EXCLUDING shipping. Shipping is
 * a pass-through cost (no margin for the business), so the rep earns nothing on
 * it — decided 2026-06-28. Pass `shippingTotal` and it's subtracted from the
 * base; omit it (default 0) for the legacy "% of gross sale" behaviour. It never
 * changes the customer price; it only shows the boss what the rep earns and the
 * net profit left after paying it. Pure function — client-safe (no env, no I/O).
 */

export interface CommissionBreakdown {
  /** The commission rate actually used (%). */
  pct: number;
  /** The base the commission is charged on = deal EXCLUDING shipping. */
  base: number;
  /** Commission amount in ILS = base × pct / 100. */
  commission: number;
  /** Profit left after paying the commission (profit − commission). */
  netProfit: number;
  /** Commission as a % of profit — boss insight into how much of the margin it eats. */
  ofProfitPct: number;
}

export const DEFAULT_COMMISSION_PCT = 10;

export function computeCommission(
  totalSale: number,
  totalProfit: number,
  commissionPct: number | undefined | null,
  shippingTotal: number = 0
): CommissionBreakdown {
  const pct =
    typeof commissionPct === "number" && Number.isFinite(commissionPct)
      ? commissionPct
      : DEFAULT_COMMISSION_PCT;
  // Commission base = deal excluding shipping (shipping carries no margin).
  const commissionableBase = Math.max(0, totalSale - (shippingTotal || 0));
  const commission = (commissionableBase * pct) / 100;
  const netProfit = totalProfit - commission;
  const ofProfitPct = totalProfit > 0 ? (commission / totalProfit) * 100 : 0;
  return { pct, base: commissionableBase, commission, netProfit, ofProfitPct };
}

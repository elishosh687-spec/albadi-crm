/**
 * Salesperson commission — DISPLAY-ONLY, BOSS-ONLY.
 *
 * The commission is a flat % of the TOTAL sale (gross deal amount). It never
 * changes the customer price; it only shows the boss what the rep earns and the
 * net profit left after paying it. Pure function — client-safe (no env, no I/O).
 */

export interface CommissionBreakdown {
  /** The commission rate actually used (%). */
  pct: number;
  /** Commission amount in ILS = totalSale × pct / 100. */
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
  commissionPct: number | undefined | null
): CommissionBreakdown {
  const pct =
    typeof commissionPct === "number" && Number.isFinite(commissionPct)
      ? commissionPct
      : DEFAULT_COMMISSION_PCT;
  const commission = (totalSale * pct) / 100;
  const netProfit = totalProfit - commission;
  const ofProfitPct = totalProfit > 0 ? (commission / totalProfit) * 100 : 0;
  return { pct, commission, netProfit, ofProfitPct };
}

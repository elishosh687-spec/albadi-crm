/**
 * What exactly is stored on the יעקב חרמון deal — actual costs, commission,
 * other-cost lines, Zoho refs — and how the card's profit is derived.
 *   DATABASE_URL="$(...)" npx tsx scripts/_diag-yaakov-actuals.ts
 */
import { listClosedQuotes } from "@/lib/factory/server/closed";
import { computeCommission } from "@/lib/factory/commission";

const ils = (n: number | undefined | null) => `₪${(n ?? 0).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

async function main() {
  const deals = await listClosedQuotes();
  for (const d of deals) {
    const fp = d.finalPricing;
    const ac = d.actualCosts;
    if (!fp) continue;
    console.log(`\n=== ${d.customerName} (${d.quotationNo ?? d.id})`);
    console.log(`   מחיר ללקוח (grandTotalExVat) = ${ils(d.grandTotalExVat)}`);
    console.log(`   engine: totalCost=${ils(fp.totalCost)} totalShipping=${ils(fp.totalShipping)} totalProfit(GROSS)=${ils(fp.totalProfit)} commissionPct=${fp.commissionPct ?? "—"}`);
    const comm = computeCommission(d.grandTotalExVat, fp.totalProfit ?? 0, fp.commissionPct, fp.totalShipping ?? 0);
    console.log(`   עמלה מחושבת: בסיס ${ils(comm.base)} × ${comm.pct}% = ${ils(comm.commission)}`);
    if (!ac) { console.log("   actualCosts: — (לא הוזן)"); continue; }
    console.log(`   actualCosts:`);
    console.log(`      factoryTotalIls=${ac.factoryTotalIls ?? "—"} shippingTotalIls=${ac.shippingTotalIls ?? "—"} actualRevenueIls=${ac.actualRevenueIls ?? "—"} commissionIls=${ac.commissionIls ?? "—"}`);
    console.log(`      otherCosts: ${JSON.stringify(ac.otherCosts ?? [])}`);
    console.log(`      zohoRefs: ${JSON.stringify(ac.zohoRefs ?? [])}`);
    const otherTotal = (ac.otherCosts ?? []).reduce((s, c) => s + (Number(c.amountIls) || 0), 0);
    const commission = ac.commissionIls != null ? ac.commissionIls : Math.round(comm.commission);
    const revenue = ac.actualRevenueIls ?? d.grandTotalExVat;
    const profit =
      (fp.totalProfit ?? 0) +
      (revenue - d.grandTotalExVat) -
      ((ac.factoryTotalIls ?? fp.totalCost ?? 0) - (fp.totalCost ?? 0)) -
      ((ac.shippingTotalIls ?? fp.totalShipping ?? 0) - (fp.totalShipping ?? 0)) -
      otherTotal -
      commission;
    console.log(`   ➜ רווח בפועל = רווח ברוטו ${ils(fp.totalProfit)} − עמלה ${ils(commission)} − עלויות אחרות ${ils(otherTotal)} ± דלתאות = ${ils(profit)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

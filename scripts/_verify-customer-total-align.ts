/**
 * Verify the customer-total alignment across every closed deal:
 * OLD (engine totalSellingPrice) vs NEW (customerTotalExVat = what was quoted),
 * and that the deal's payment schedule now sits on the same figure.
 *
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/_verify-customer-total-align.ts
 */
import { listClosedQuotes } from "@/lib/factory/server/closed";
import { customerTotalExVat } from "@/lib/factory/customer-total";

const r2 = (n: number) => Math.round(n * 100) / 100;
const ils = (n: number) => `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

async function main() {
  const deals = await listClosedQuotes();
  console.log(`closed deals: ${deals.length}\n`);
  let drifted = 0;
  let totalGap = 0;

  for (const d of deals) {
    const lines = d.products.filter((p) => p.finalPricing);
    const oldSum = r2(lines.reduce((s, p) => s + (p.finalPricing!.totalSellingPrice ?? 0), 0));
    const newSum = r2(lines.reduce((s, p) => s + (customerTotalExVat(p.finalPricing) ?? 0), 0));
    const gap = r2(newSum - oldSum);
    const sched = d.paymentSchedule;
    const schedOk = sched ? r2(sched.subtotal) === newSum : null;
    if (gap !== 0) { drifted++; totalGap += gap; }

    console.log(
      `${gap !== 0 ? "⚠️ " : "   "}${(d.customerName ?? "—").padEnd(20)} ${d.isCombined ? "[משולבת]" : "         "} ` +
        `היה ${ils(oldSum).padStart(10)} → עכשיו ${ils(newSum).padStart(10)}  (${gap >= 0 ? "+" : ""}${ils(gap)})` +
        (sched ? `  | תשלומים על ${ils(r2(sched.subtotal))} ${schedOk ? "✓" : "✗ לא תואם!"}` : "  | ללא תנאי תשלום")
    );
    if (d.isCombined) {
      for (const p of lines) {
        console.log(
          `        · ${p.quotationNo ?? p.id.slice(-8)} qty ${p.finalPricing!.quantity} × ₪${p.finalPricing!.unitSellingPrice}` +
            ` → ${ils(customerTotalExVat(p.finalPricing) ?? 0)} (היה ${ils(p.finalPricing!.totalSellingPrice ?? 0)})`
        );
      }
    }
  }
  console.log(`\nעסקאות שהמספר בהן השתנה: ${drifted}/${deals.length} · סה״כ פער ${ils(r2(totalGap))}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

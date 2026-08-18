/**
 * Scratch: why does the עסקאות (deals) card show different money than the
 * הצעות מחיר (quotes) list for the SAME quotes? (Eli, יוסי גולד בייבי)
 *
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/_diag-combined-mismatch.ts
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { splitCustomerView } from "@/lib/factory/shipping-split";
import { memberDisplayTotalExVat } from "@/lib/factory/server/closed";
import type { FactoryPricingResult } from "@/lib/factory/types";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      quotationNo: factoryQuoteRequests.quotationNo,
      status: factoryQuoteRequests.factoryStatus,
      groupId: factoryQuoteRequests.dealGroupId,
      closedAt: factoryQuoteRequests.closedDealAt,
      finalPricing: factoryQuoteRequests.finalPricing,
      name: leads.name,
    })
    .from(factoryQuoteRequests)
    .innerJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(and(isNull(factoryQuoteRequests.deletedAt), eq(leads.name, "יוסי גולד בייבי")));

  console.log(`rows: ${rows.length}\n`);
  for (const r of rows) {
    const fp = r.finalPricing as (FactoryPricingResult & { totalOrderPriceIls?: number }) | null;
    console.log(`— ${r.quotationNo} (${r.id}) status=${r.status} group=${r.groupId ?? "—"} closed=${r.closedAt ? "yes" : "no"}`);
    if (!fp) { console.log("   no finalPricing\n"); continue; }
    const molds = r2(fp.moldsTotalSellingPriceIls ?? 0);
    console.log(`   qty=${fp.quantity} unitSellingPrice=${fp.unitSellingPrice} molds=${molds} split=${fp.shippingSplit ? "yes" : "no"}`);
    console.log(`   totalSellingPrice      = ${fp.totalSellingPrice}`);
    console.log(`   totalOrderPriceIls     = ${fp.totalOrderPriceIls ?? "(absent)"}`);
    console.log(`   r2(unit)*qty + molds   = ${r2(r2(fp.unitSellingPrice) * fp.quantity) + molds}   <- memberDisplayTotalExVat`);
    console.log(`   memberDisplayTotalExVat= ${memberDisplayTotalExVat(fp)}`);
    if (fp.shippingSplit) {
      console.log(`   splitCustomerView      = ${splitCustomerView(fp.shippingSplit, molds).grandTotalIls}`);
    }
    // What the quotes LIST prints:
    const listTotal = fp.shippingSplit
      ? splitCustomerView(fp.shippingSplit, molds).grandTotalIls
      : (fp.totalOrderPriceIls ?? fp.totalSellingPrice);
    console.log(`   ➜ QUOTES LIST shows    = ₪${Math.round(listTotal)}`);
    console.log(`   ➜ DEALS card shows     = ₪${memberDisplayTotalExVat(fp)}`);
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

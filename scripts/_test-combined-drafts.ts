/**
 * Can two DRAFT quotes form a combined offer? Runs the same allocation the
 * modal/PDF/WhatsApp now use, on Asaf Grinshpan's two self-priced drafts.
 *
 *   DATABASE_URL="$(...)" npx tsx scripts/_test-combined-drafts.ts [customerName]
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, isNull, sql } from "drizzle-orm";
import { allocateCombined, resolveMergedShippingOption } from "@/lib/factory/combined";
import { getFactoryConfig } from "@/lib/factory/config";
import { customerTotalExVat } from "@/lib/factory/customer-total";
import type { FactoryPricingResult } from "@/lib/factory/types";

const ils = (n: number) => `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const name = process.argv[2] ?? "Asaf Grinshpan";
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      q: factoryQuoteRequests.quotationNo,
      status: factoryQuoteRequests.factoryStatus,
      fp: factoryQuoteRequests.finalPricing,
      resp: factoryQuoteRequests.factoryResponse,
      createdAt: factoryQuoteRequests.createdAt,
    })
    .from(factoryQuoteRequests)
    .innerJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(and(isNull(factoryQuoteRequests.deletedAt), sql`${leads.name} = ${name}`));

  const priced = rows
    .filter((r) => r.fp && (r.status === "finalized" || r.status === "draft"))
    .sort((a, b) => +a.createdAt - +b.createdAt);
  console.log(`${name}: ${rows.length} הצעות · ${priced.length} מתומחרות\n`);
  if (priced.length < 2) return console.log("צריך לפחות 2 מתומחרות");

  for (const p of priced) {
    const fp = p.fp as FactoryPricingResult;
    console.log(
      `  ${p.q} [${p.status}] ${p.resp ? "מפעל ענה" : "טיוטה (אומדן)"} · ` +
        `${fp.quantity} × ₪${fp.unitSellingPrice} = ${ils(customerTotalExVat(fp) ?? 0)} · CBM ${fp.totalCbm}`
    );
  }
  const separate = r2(priced.reduce((s, p) => s + (customerTotalExVat(p.fp as FactoryPricingResult) ?? 0), 0));

  const config = await getFactoryConfig();
  const items = priced.map((p) => ({ id: p.id, pricing: p.fp as FactoryPricingResult }));
  const singleOpt = resolveMergedShippingOption(items, config);
  const alloc = allocateCombined(items, singleOpt, config);

  console.log(`\n  בנפרד:  ${ils(separate)}`);
  console.log(`  משולב (${singleOpt?.name ?? "—"}):`);
  for (const p of alloc.perProduct) {
    const q = priced.find((x) => x.id === p.id)?.q;
    console.log(`     ${q}: ${p.adjusted.quantity} × ₪${p.adjusted.unitSellingPrice} = ${ils(customerTotalExVat(p.adjusted) ?? 0)}`);
  }
  console.log(`  סה״כ משולב: ${ils(alloc.grandTotal)}  (חיסכון ללקוח ${ils(r2(separate - alloc.grandTotal))})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

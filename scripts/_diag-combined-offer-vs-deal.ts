/**
 * What does the COMBINED OFFER (PDF/WhatsApp) actually quote, vs what the
 * עסקאות deal card shows? The combined offer re-prices on ONE merged shipment
 * (allocateCombined) and is NOT persisted anywhere.
 *
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/_diag-combined-offer-vs-deal.ts
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { allocateCombined } from "@/lib/factory/combined";
import { getFactoryConfig } from "@/lib/factory/config";
import { customerTotalExVat } from "@/lib/factory/customer-total";
import type { FactoryPricingResult } from "@/lib/factory/types";

const ils = (n: number) => `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      q: factoryQuoteRequests.quotationNo,
      groupId: factoryQuoteRequests.dealGroupId,
      fp: factoryQuoteRequests.finalPricing,
      name: leads.name,
    })
    .from(factoryQuoteRequests)
    .innerJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(and(isNull(factoryQuoteRequests.deletedAt), isNotNull(factoryQuoteRequests.dealGroupId)));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.groupId!;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const config = await getFactoryConfig();

  for (const [gid, members] of groups) {
    if (members.length < 2) continue;
    console.log(`\n=== ${members[0].name} — ${members.length} מוצרים (${gid})`);

    const sumOfQuotes = r2(members.reduce((s, m) => s + (customerTotalExVat(m.fp as FactoryPricingResult) ?? 0), 0));

    const singleOpt =
      config.shippingOptions.find((s) => s.id === (members[0].fp as FactoryPricingResult)?.shippingOptionId) ?? null;
    const alloc = allocateCombined(
      members.map((m) => ({ id: m.id, pricing: m.fp as FactoryPricingResult })),
      singleOpt,
      config
    );
    const adj = new Map(alloc.perProduct.map((x) => [x.id, x.adjusted]));

    console.log("  לפי ההצעות הנפרדות (מה שהעסקה מציגה היום):");
    for (const m of members) {
      const fp = m.fp as FactoryPricingResult;
      console.log(`    ${m.q}: ${fp.quantity} × ₪${fp.unitSellingPrice} = ${ils(customerTotalExVat(fp) ?? 0)}`);
    }
    console.log(`    סה״כ = ${ils(sumOfQuotes)}`);

    console.log(`  לפי ההצעה המשולבת (משלוח אחד · ${singleOpt?.name ?? "—"}):`);
    for (const m of members) {
      const a = adj.get(m.id)!;
      console.log(`    ${m.q}: ${a.quantity} × ₪${a.unitSellingPrice} = ${ils(customerTotalExVat(a) ?? 0)}`);
    }
    console.log(`    סה״כ = ${ils(alloc.grandTotal)}`);
    console.log(`  ➜ הפרש: ${ils(r2(alloc.grandTotal - sumOfQuotes))}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

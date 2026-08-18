/**
 * Freeze the COMBINED offer for deal groups closed BEFORE the snapshot existed.
 * Uses the same defaults as /api/factory/combine/pdf (no manual CBM / split) —
 * so it reproduces the combined PDF as it renders today.
 *
 * Dry-run by default; pass --go to write.
 *   DATABASE_URL="$(...)" npx tsx scripts/_backfill-combined-pricing.ts [--go]
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { buildCombinedPricing } from "@/lib/factory/server/closed";
import { customerTotalExVat } from "@/lib/factory/customer-total";
import type { FactoryPricingResult } from "@/lib/factory/types";

const GO = process.argv.includes("--go");
const ils = (n: number) => `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      q: factoryQuoteRequests.quotationNo,
      groupId: factoryQuoteRequests.dealGroupId,
      fp: factoryQuoteRequests.finalPricing,
      combined: factoryQuoteRequests.combinedPricing,
      createdAt: factoryQuoteRequests.createdAt,
      name: leads.name,
    })
    .from(factoryQuoteRequests)
    .innerJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(and(isNull(factoryQuoteRequests.deletedAt), isNotNull(factoryQuoteRequests.dealGroupId)));

  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.groupId!, [...(groups.get(r.groupId!) ?? []), r]);

  console.log(`${GO ? "WRITE" : "DRY-RUN"} · ${groups.size} קבוצות\n`);
  for (const [gid, members] of groups) {
    members.sort((a, b) => +a.createdAt - +b.createdAt);
    if (members.length < 2) { console.log(`- ${gid}: חבר יחיד, מדלג`); continue; }
    if (members.some((m) => m.combined)) { console.log(`- ${gid}: כבר יש snapshot, מדלג`); continue; }

    const sum = r2(members.reduce((s, m) => s + (customerTotalExVat(m.fp as FactoryPricingResult) ?? 0), 0));
    const snap = await buildCombinedPricing(members.map((m) => m.id));
    if (!snap) { console.log(`- ${gid}: אין תמחור, מדלג`); continue; }

    console.log(`${members[0].name} (${gid})`);
    console.log(`   סכום ההצעות הנפרדות: ${ils(sum)}`);
    console.log(`   ההצעה המשולבת:        ${ils(snap.grandTotalIls)}  (${ils(r2(snap.grandTotalIls - sum))})`);
    for (const p of snap.perProduct) {
      const m = members.find((x) => x.id === p.id);
      console.log(`     ${m?.q}: ${p.pricing.quantity} × ₪${p.pricing.unitSellingPrice} = ${ils(customerTotalExVat(p.pricing) ?? 0)}`);
    }
    if (GO) {
      await db
        .update(factoryQuoteRequests)
        .set({ combinedPricing: snap, updatedAt: new Date() })
        .where(eq(factoryQuoteRequests.id, snap.perProduct[0].id));
      console.log(`   ✔ נשמר על ${snap.perProduct[0].id}`);
    }
    console.log("");
  }
  if (!GO) console.log("(הרץ עם --go כדי לכתוב)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

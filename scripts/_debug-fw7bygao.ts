/**
 * Scratch: figure out why FW7BYGAO is not being imported from Feishu.
 *
 * Run with neonctl one-liner:
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string ...)" \
 *   npx tsx scripts/_debug-fw7bygao.ts
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, like, or, sql } from "drizzle-orm";
import { readAllRows, findRowByQuotationNo, readRow, baseQuoteNo } from "@/lib/feishu/sheets";

const TARGET = "FW7BYGAO";

function normName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['`´‘’׳״‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  // 1. Does it already exist in DB?
  const inDb = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.quotationNo, TARGET));
  console.log(`\n[1] DB rows with quotationNo=${TARGET}: ${inDb.length}`);
  for (const r of inDb) {
    console.log(`    id=${r.id} sid=${r.manychatSubId} status=${r.factoryStatus} row=${r.feishuRowIndex}`);
  }

  // 2. Find row in sheet
  const rowIdx = await findRowByQuotationNo(TARGET);
  console.log(`\n[2] findRowByQuotationNo("${TARGET}") => ${rowIdx ?? "NOT FOUND"}`);
  if (!rowIdx) {
    console.log("    -> Quote number not in sheet at all. Aborting.");
    process.exit(0);
  }

  const cells = await readRow(rowIdx);
  const customer = String(cells[0] ?? "").trim();
  const rawQuoteNo = String(cells[1] ?? "").trim();
  console.log(`\n[3] Sheet row ${rowIdx}: customer="${customer}", quotationNo="${rawQuoteNo}"`);
  console.log(`    normalized customer: "${normName(customer)}"`);
  console.log(`    base quote no: "${baseQuoteNo(rawQuoteNo)}"`);
  console.log(`    matches regex: ${/^[A-Z0-9]{4,}(-[A-Z0-9]+)?$/i.test(rawQuoteNo)}`);

  // 4. How many rows would readAllRows(500) return?
  const all = await readAllRows(500);
  console.log(`\n[4] readAllRows(500) returned ${all.length} rows (target row index = ${rowIdx})`);
  const targetIdx0 = Number(rowIdx) - 1;
  console.log(`    is target index within range? ${targetIdx0 < all.length}`);

  // 5. Try to find a matching lead
  const target = normName(customer);
  console.log(`\n[5] Looking for lead matching normalized="${target}"`);

  const allLeads = await db.select({ sid: leads.manychatSubId, name: leads.name }).from(leads);
  const matches: Array<{ sid: string; name: string | null; key: string }> = [];
  for (const l of allLeads) {
    const key = normName(l.name ?? "");
    if (!key) continue;
    if (key === target) matches.push({ sid: l.sid, name: l.name, key });
  }
  console.log(`    exact normalized matches: ${matches.length}`);
  for (const m of matches) console.log(`      sid=${m.sid} name="${m.name}"`);

  if (matches.length === 0) {
    // Try partial — split on dash and try each half
    console.log(`\n[6] No exact match. Trying tokens (split on " - "):`);
    const parts = customer.split(/\s*[-–]\s*/).map((p) => p.trim()).filter(Boolean);
    console.log(`    parts: ${JSON.stringify(parts)}`);
    for (const part of parts) {
      const pNorm = normName(part);
      const partMatches = allLeads.filter((l) => normName(l.name ?? "") === pNorm);
      console.log(`    "${part}" (norm="${pNorm}") -> ${partMatches.length} leads`);
      for (const m of partMatches.slice(0, 3)) console.log(`        sid=${m.sid} name="${m.name}"`);
    }

    // ILIKE search to surface near matches
    console.log(`\n[7] DB ILIKE search for substrings of customer:`);
    for (const part of parts) {
      const like1 = await db
        .select({ sid: leads.manychatSubId, name: leads.name })
        .from(leads)
        .where(sql`${leads.name} ILIKE ${'%' + part + '%'}`)
        .limit(5);
      console.log(`    ILIKE "%${part}%": ${like1.length}`);
      for (const m of like1) console.log(`        sid=${m.sid} name="${m.name}"`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

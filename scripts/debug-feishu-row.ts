/**
 * Reads the latest pending factory_quote_requests row and dumps both
 * the DB record and what's actually in the matching Feishu sheet row.
 *
 * Run: npx tsx scripts/debug-feishu-row.ts
 */

import "dotenv/config";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { readRow, parseFactoryResponseRow } from "@/lib/feishu/sheets";

async function main() {
  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .orderBy(desc(factoryQuoteRequests.createdAt))
    .limit(5);

  console.log(`\nLatest ${rows.length} factory_quote_requests:`);
  for (const r of rows) {
    console.log(
      `  id=${r.id.slice(0, 8)} status=${r.factoryStatus} row=${r.feishuRowIndex} created=${r.createdAt.toISOString()}`
    );
  }

  const pending = rows.find((r) => r.factoryStatus === "pending" && r.feishuRowIndex);
  if (!pending) {
    console.log("\nNo pending row with feishuRowIndex found.");
    return;
  }

  console.log(`\n=== Reading Feishu row ${pending.feishuRowIndex} ===`);
  const cells = await readRow(pending.feishuRowIndex!);
  console.log(`Got ${cells.length} cells:`);
  const labels = [
    "A:Customer", "B:Quotation#", "C:Pic", "D:Description", "E:Material",
    "F:Size", "G:Printing", "H:Finishing", "I:Quantity",
    "J:Price¥", "K:CartonQty", "L:LengthCm", "M:WidthCm", "N:HeightCm",
    "O:CBM", "P:WeightKg", "Q:Supplier", "R:Remark",
  ];
  for (let i = 0; i < Math.max(cells.length, 18); i++) {
    const v = cells[i];
    console.log(`  [${i}] ${labels[i] ?? `col${i}`} = ${JSON.stringify(v)}`);
  }

  console.log(`\n=== parseFactoryResponseRow ===`);
  const parsed = parseFactoryResponseRow(cells);
  console.log(parsed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

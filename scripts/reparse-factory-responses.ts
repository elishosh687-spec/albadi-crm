/**
 * One-shot: re-read every factory_quote_request that has a feishuRowIndex
 * and re-parse the row with the fixed column mapping. Updates factoryResponse
 * for rows currently in status `received` (and only if the new parse yields
 * a different value — to avoid bumping updatedAt for nothing).
 *
 * Usage:
 *   npx tsx scripts/reparse-factory-responses.ts [--go]
 *   (omit --go for dry-run)
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq, isNotNull } from "drizzle-orm";
import { readRow, parseFactoryResponseRow } from "@/lib/feishu/sheets";

async function main() {
  const apply = process.argv.includes("--go");
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      status: factoryQuoteRequests.factoryStatus,
      q: factoryQuoteRequests.quotationNo,
      idx: factoryQuoteRequests.feishuRowIndex,
      resp: factoryQuoteRequests.factoryResponse,
    })
    .from(factoryQuoteRequests)
    .where(isNotNull(factoryQuoteRequests.feishuRowIndex));

  let scanned = 0;
  let changed = 0;
  for (const r of rows) {
    if (!r.idx) continue;
    scanned++;
    try {
      const cells = await readRow(r.idx);
      const parsed = parseFactoryResponseRow(cells);
      const before = JSON.stringify(r.resp ?? {});
      const after = JSON.stringify(parsed);
      if (before === after) {
        console.log(`= ${r.id} q#${r.q} idx=${r.idx} no-change`);
        continue;
      }
      changed++;
      console.log(`~ ${r.id} q#${r.q} idx=${r.idx}`);
      console.log(`  before unitCost=${(r.resp as any)?.unitCostCny}, supplier=${(r.resp as any)?.supplier}`);
      console.log(`  after  unitCost=${parsed.unitCostCny}, supplier=${parsed.supplier}`);
      if (apply && parsed.hasResponse) {
        await db
          .update(factoryQuoteRequests)
          .set({ factoryResponse: parsed, updatedAt: new Date() })
          .where(eq(factoryQuoteRequests.id, r.id));
      }
    } catch (err) {
      console.warn(`! ${r.id} read failed:`, err);
    }
  }
  console.log(`\nscanned=${scanned} changed=${changed} apply=${apply}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

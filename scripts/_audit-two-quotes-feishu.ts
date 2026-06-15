/**
 * Probes Feishu rows 19 + 20 for quotationNos 1XM6TMED + 15JQUZLK.
 * Also runs findRowByQuotationNo to detect drift.
 */
import "dotenv/config";
import {
  readRow,
  findRowByQuotationNo,
  parseFactoryResponseRow,
} from "../lib/feishu/sheets";

const CASES = [
  { code: "1XM6TMED", storedRow: "19" },
  { code: "15JQUZLK", storedRow: "20" },
];

async function main() {
  for (const c of CASES) {
    console.log(`\n=== ${c.code} (stored feishu_row_index=${c.storedRow}) ===`);
    try {
      const cells = await readRow(c.storedRow);
      console.log(`  A (customer):  ${JSON.stringify(cells[0])}`);
      console.log(`  B (quoteNo):   ${JSON.stringify(cells[1])}`);
      console.log(`  C (date):      ${JSON.stringify(cells[2])}`);
      console.log(`  E (descr):     ${JSON.stringify(cells[4])}`);
      console.log(`  I (finishing): ${JSON.stringify(cells[8])}`);
      console.log(`  J (qty):       ${JSON.stringify(cells[9])}`);
      console.log(`  K (unitCost):  ${JSON.stringify(cells[10])}`);
      console.log(`  L (carton qty): ${JSON.stringify(cells[11])}`);
      console.log(`  R (supplier):  ${JSON.stringify(cells[17])}`);
      const parsed = parseFactoryResponseRow(cells);
      console.log(`  parsed.hasResponse: ${parsed.hasResponse}  unitCostCny=${parsed.unitCostCny}`);
      const matchesB =
        String(cells[1] ?? "").trim().replace(/-[A-Za-z0-9]+$/, "").toUpperCase() === c.code;
      console.log(`  col B matches code: ${matchesB}`);
    } catch (err) {
      console.error(`  readRow failed:`, err);
    }
    try {
      const live = await findRowByQuotationNo(c.code);
      console.log(`  findRowByQuotationNo("${c.code}") → ${live ?? "null"}`);
      if (live && live !== c.storedRow) {
        console.log(`  ⚠️ DRIFT: stored=${c.storedRow} live=${live}`);
      }
    } catch (err) {
      console.error(`  findRowByQuotationNo failed:`, err);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

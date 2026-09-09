import "dotenv/config";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { readRow, parseFactoryResponseRow } from "@/lib/feishu/sheets";

async function main() {
  const row = await db.select().from(factoryQuoteRequests).where(eq(factoryQuoteRequests.quotationNo, "FW7BYGAO"));
  console.log("DB record:");
  console.log("  status:", row[0].factoryStatus);
  console.log("  factoryResponse:", JSON.stringify(row[0].factoryResponse));
  console.log("  createdAt:", row[0].createdAt.toISOString());
  console.log("  updatedAt:", row[0].updatedAt?.toISOString?.());
  console.log("  feishuRowIndex:", row[0].feishuRowIndex);

  const cells = await readRow(row[0].feishuRowIndex!);
  console.log(`\nSheet row ${row[0].feishuRowIndex} cells:`);
  const labels = ["A:Customer","B:Quote#","C:Date","D:Pic","E:Desc","F:Material","G:Size","H:Printing","I:Finishing","J:Qty","K:Price","L:CartonQty","M:L","N:W","O:H","P:CBM","Q:Weight","R:Supplier","S:Remark"];
  for (let i=0;i<Math.min(cells.length,labels.length);i++) console.log(`  [${i}] ${labels[i]} = ${JSON.stringify(cells[i])}`);
  console.log("\nparseFactoryResponseRow:");
  console.log(parseFactoryResponseRow(cells));
}
main().catch(e => { console.error(e); process.exit(1); });

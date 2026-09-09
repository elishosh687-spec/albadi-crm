import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const qs = ["V5CLAI5C", "P2WXR65R", "55HETX5D", "PANLUIB8", "KYLWS12A", "FW7BYGAO"];
  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(inArray(factoryQuoteRequests.quotationNo, qs));
  for (const r of rows) {
    console.log(
      `\n=== ${r.quotationNo} row=${r.feishuRowIndex} status=${r.status} updated=${r.updatedAt?.toISOString().slice(0, 10)} ===`
    );
    console.log(JSON.stringify(r.factoryResponse, null, 2));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

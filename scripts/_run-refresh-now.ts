import "dotenv/config";
import { refreshFromFeishu } from "@/lib/factory/server/refresh";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  console.log("BEFORE:");
  const before = await db.select().from(factoryQuoteRequests).where(eq(factoryQuoteRequests.quotationNo, "FW7BYGAO"));
  console.log("  status:", before[0]?.factoryStatus, " resp:", JSON.stringify(before[0]?.factoryResponse));

  const r = await refreshFromFeishu();
  console.log("\nREFRESH RESULT:");
  console.log("  scanned:", r.scanned, " updated:", r.updated);
  for (const u of r.updates) console.log("    ", u.id, "row:", u.rowIndex);

  console.log("\nAFTER:");
  const after = await db.select().from(factoryQuoteRequests).where(eq(factoryQuoteRequests.quotationNo, "FW7BYGAO"));
  console.log("  status:", after[0]?.factoryStatus, " resp:", JSON.stringify(after[0]?.factoryResponse));
}
main().catch(e => { console.error(e); process.exit(1); });

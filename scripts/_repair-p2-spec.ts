/**
 * One-off repair: P2WXR65R's productSpec got stored field-shifted (size string
 * landed in `printing`, colour count in `finishing`, bag-type in `material`,
 * dims + quantity left at 0). The Feishu request row 38 is CORRECT, so rebuild
 * the spec from it + the size string. Only this one row is affected (20 recent
 * specs checked; the rest are fine).
 *
 * Correct values (Feishu row 38 / size "H35*D10*W30"):
 *   material  80g non-woven | W30 H35 D10 | printing "4 colors"
 *   finishing "No handles / Not laminated" | quantity 5000 (Feishu K)
 *
 * Usage: DATABASE_URL=... npx tsx scripts/_repair-p2-spec.ts [--go]
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import type { FactoryProductSpec } from "@/lib/factory/types";

async function main() {
  const apply = process.argv.includes("--go");
  const [row] = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.quotationNo, "P2WXR65R"))
    .limit(1);
  if (!row) {
    console.log("P2WXR65R not found");
    process.exit(1);
  }
  const cur = row.productSpec as FactoryProductSpec;
  console.log("BEFORE:", JSON.stringify(cur, null, 2));

  const fixed: FactoryProductSpec = {
    ...cur,
    description: "30×35×10 ס״מ — מוצר מותאם",
    material: "80g non-woven",
    widthCm: 30,
    heightCm: 35,
    depthCm: 10,
    quantity: 5000,
    printing: "4 colors",
    finishing: "No handles / Not laminated",
  };
  console.log("\nAFTER:", JSON.stringify(fixed, null, 2));

  if (apply) {
    await db
      .update(factoryQuoteRequests)
      .set({ productSpec: fixed, updatedAt: new Date() })
      .where(eq(factoryQuoteRequests.id, row.id));
    console.log("\n✓ written");
  } else {
    console.log("\n(dry-run — pass --go to write)");
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const byStatus = await db.execute(sql`
    SELECT factory_status, COUNT(*)::int AS n
    FROM factory_quote_requests
    GROUP BY factory_status ORDER BY n DESC
  `);
  console.log("by status:", byStatus.rows);

  const materials = await db.execute(sql`
    SELECT product_spec->>'material' AS material, COUNT(*)::int AS n
    FROM factory_quote_requests
    GROUP BY 1 ORDER BY n DESC LIMIT 30
  `);
  console.log("\ndistinct materials (top 30):");
  console.table(materials.rows);

  const nonWoven = await db.execute(sql`
    SELECT factory_status, COUNT(*)::int AS n
    FROM factory_quote_requests
    WHERE (
      product_spec->>'material' ILIKE '%80%'
      OR product_spec->>'material' ILIKE '%non%woven%'
      OR product_spec->>'material' ILIKE '%non-woven%'
      OR product_spec->>'material' ILIKE '%נון%'
      OR product_spec->>'material' ILIKE '%לא ארוג%'
    )
    GROUP BY factory_status ORDER BY n DESC
  `);
  console.log("\n80g/non-woven candidates by status:");
  console.table(nonWoven.rows);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

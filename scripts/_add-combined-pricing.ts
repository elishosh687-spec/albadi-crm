/**
 * Direct DDL: add factory_quote_requests.combined_pricing (jsonb).
 * drizzle-kit push hangs on this schema (CLAUDE.md), so columns go in by hand.
 *
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/_add-combined-pricing.ts
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`ALTER TABLE factory_quote_requests ADD COLUMN IF NOT EXISTS combined_pricing jsonb`);
  const res = await db.execute(sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'factory_quote_requests' AND column_name = 'combined_pricing'
  `);
  console.log("combined_pricing:", JSON.stringify(res.rows ?? res));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

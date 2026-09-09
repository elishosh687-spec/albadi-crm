import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`ALTER TABLE factory_quote_requests ADD COLUMN IF NOT EXISTS deal_removed_at timestamptz`);
  console.log("✓ deal_removed_at column ensured");
  process.exit(0);
}
main();

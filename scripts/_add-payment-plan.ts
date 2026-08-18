import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  await db.execute(sql`ALTER TABLE factory_quote_requests ADD COLUMN IF NOT EXISTS payment_plan jsonb`);
  console.log("✓ payment_plan column ensured");
  process.exit(0);
}
main();

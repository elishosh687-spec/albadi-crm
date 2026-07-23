/**
 * One-shot: add factory_quote_requests.deleted_at (soft-delete / recycle bin).
 * Idempotent. Run with the neonctl one-liner (see CLAUDE.md):
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/_add-deleted-at.ts
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    ALTER TABLE factory_quote_requests
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  `);
  console.log("factory_quote_requests.deleted_at added");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

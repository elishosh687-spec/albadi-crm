/**
 * One-shot: add eli_intent_override column. Idempotent.
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    ALTER TABLE bot_decision_log
    ADD COLUMN IF NOT EXISTS eli_intent_override TEXT;
  `);
  console.log("eli_intent_override column added");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

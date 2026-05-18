/**
 * One-shot: every active lead with pipeline_stage = NULL → set to 'NEW'.
 * Doesn't touch leads with any explicit stage (incl. DROPPED/WON).
 * Idempotent.
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const before = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM leads WHERE pipeline_stage IS NULL AND active = true;
  `);
  const n = (before.rows[0] as any).n;
  console.log(`leads with pipeline_stage=NULL: ${n}`);

  if (n === 0) {
    console.log("nothing to backfill");
    process.exit(0);
  }

  await db.execute(sql`
    UPDATE leads
    SET pipeline_stage = 'NEW', updated_at = now()
    WHERE pipeline_stage IS NULL AND active = true;
  `);
  console.log(`backfilled ${n} leads to NEW`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

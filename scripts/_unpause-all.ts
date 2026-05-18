/**
 * Turn the bot back on for every active lead that was paused.
 * Resets cadence so the supervisor gets a fresh window before nudging.
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const before = await db.execute(sql`
    SELECT manychat_sub_id, name, pipeline_stage, pipeline_flag
    FROM leads
    WHERE active = true AND bot_paused = true;
  `);

  console.log(`\nLeads currently paused: ${before.rows.length}\n`);
  console.table(before.rows);

  if (before.rows.length === 0) {
    console.log("nothing to unpause");
    process.exit(0);
  }

  await db.execute(sql`
    UPDATE leads
    SET bot_paused      = false,
        pipeline_flag   = NULL,
        follow_up_count = 0,
        last_follow_up_at = now(),
        updated_at      = now()
    WHERE active = true AND bot_paused = true;
  `);

  console.log(`\n✅ unpaused ${before.rows.length} leads`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

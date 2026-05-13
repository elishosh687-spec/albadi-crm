/**
 * Backfill messages.sender for rows created before the column existed.
 *
 *   direction = 'in'                         → sender = 'lead'
 *   direction = 'out' AND wa_message_id      LIKE 'manual:%' → sender = 'eli'
 *   direction = 'out' otherwise              → sender = 'bot'
 *
 * The last bucket is a best-effort default — we have no way to retroactively
 * know whether a pre-attribution outbound was the bot or Eli typing in WA
 * Business. Most historical outbounds came from the autoresponder (bot) so
 * defaulting them to 'bot' matches reality for ~all rows. Newer rows have
 * proper attribution via sendBridgeMessage's pre-insert + the webhook
 * sender='eli' fallback, so this script is one-shot.
 *
 * Usage:
 *   npx tsx scripts/backfill-message-sender.ts         # dry run (counts only)
 *   npx tsx scripts/backfill-message-sender.ts --confirm
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const confirm = process.argv.includes("--confirm");

(async () => {
  const before = await db.execute(sql`
    SELECT
      count(*)                                              AS total,
      count(*) FILTER (WHERE sender IS NOT NULL)            AS already_tagged,
      count(*) FILTER (WHERE sender IS NULL
                         AND direction = 'in')              AS will_lead,
      count(*) FILTER (WHERE sender IS NULL
                         AND direction = 'out'
                         AND wa_message_id LIKE 'manual:%') AS will_eli,
      count(*) FILTER (WHERE sender IS NULL
                         AND direction = 'out'
                         AND (wa_message_id IS NULL OR wa_message_id NOT LIKE 'manual:%')) AS will_bot
    FROM messages
  `);

  console.log("[backfill-sender] dry-run plan:", before.rows?.[0]);

  if (!confirm) {
    console.log("[backfill-sender] re-run with --confirm to apply.");
    process.exit(0);
  }

  const r1 = await db.execute(sql`
    UPDATE messages SET sender = 'lead'
    WHERE sender IS NULL AND direction = 'in'
  `);
  const r2 = await db.execute(sql`
    UPDATE messages SET sender = 'eli'
    WHERE sender IS NULL AND direction = 'out' AND wa_message_id LIKE 'manual:%'
  `);
  const r3 = await db.execute(sql`
    UPDATE messages SET sender = 'bot'
    WHERE sender IS NULL AND direction = 'out'
      AND (wa_message_id IS NULL OR wa_message_id NOT LIKE 'manual:%')
  `);

  console.log("[backfill-sender] applied:", {
    lead: r1.rowCount,
    eli: r2.rowCount,
    bot: r3.rowCount,
  });
  process.exit(0);
})().catch((e) => {
  console.error("[backfill-sender] failed", e);
  process.exit(1);
});

import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("=== LEADS WITH MESSAGES (do they have name / phone?) ===");
  const r = await db.execute(sql`
    SELECT
      l.manychat_sub_id,
      l.name,
      l.phone_e164,
      l.wa_jid,
      l.pipeline_stage,
      l.source,
      l.updated_at::text,
      (SELECT count(*)::int FROM messages m WHERE trim(m.manychat_sub_id) = trim(l.manychat_sub_id)) AS msg_count
    FROM leads l
    WHERE EXISTS (
      SELECT 1 FROM messages m WHERE trim(m.manychat_sub_id) = trim(l.manychat_sub_id)
    )
    ORDER BY l.updated_at DESC
    LIMIT 20
  `);
  console.table(r.rows);

  console.log("\n=== SAMPLE BRIDGE EVENT FOR message.received (look for name/phone fields) ===");
  const events = await db.execute(sql`
    SELECT
      evt_id,
      type,
      occurred_at::text,
      payload->'data' AS data
    FROM bridge_events
    WHERE type = 'message.received'
    ORDER BY occurred_at DESC
    LIMIT 3
  `);
  for (const row of events.rows) {
    console.log(`---`);
    console.log(`evt=${row.evt_id} type=${row.type} at=${row.occurred_at}`);
    console.log(`data=${JSON.stringify(row.data, null, 2)}`);
  }

  console.log("\n=== LATEST MESSAGES WITH STATE ===");
  const msgs = await db.execute(sql`
    SELECT
      id, manychat_sub_id, direction, sender,
      substring(coalesce(text, '(null)') from 1 for 60) AS text_preview,
      wa_message_id,
      received_at::text
    FROM messages
    ORDER BY received_at DESC
    LIMIT 10
  `);
  console.table(msgs.rows);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

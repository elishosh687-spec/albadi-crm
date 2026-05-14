import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("=== LATEST BOT-OUT ROWS WITH FULL DETAIL ===");
  const r = await db.execute(sql`
    SELECT
      id,
      manychat_sub_id,
      direction,
      sender,
      wa_message_id,
      text,
      text IS NULL AS text_null,
      payload,
      received_at::text
    FROM messages
    WHERE direction = 'out'
    ORDER BY received_at DESC
    LIMIT 6
  `);
  for (const row of r.rows) {
    console.log(`---`);
    console.log(`id=${row.id}  sid=${row.manychat_sub_id}  sender=${row.sender}`);
    console.log(`wa_msg_id=${row.wa_message_id}`);
    console.log(`text=${JSON.stringify(row.text)}  text_null=${row.text_null}`);
    console.log(`payload=${JSON.stringify(row.payload)}`);
    console.log(`at=${row.received_at}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

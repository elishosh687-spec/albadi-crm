import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("=== MESSAGES PER SUB_ID (top 12 by count) ===");
  const counts = await db.execute(sql`
    SELECT
      manychat_sub_id,
      count(*)::int AS total,
      count(*) FILTER (WHERE direction = 'in')::int  AS inbound,
      count(*) FILTER (WHERE direction = 'out')::int AS outbound,
      count(*) FILTER (WHERE text IS NULL OR text = '')::int AS empty,
      max(received_at)::text AS last_seen
    FROM messages
    GROUP BY manychat_sub_id
    ORDER BY max(received_at) DESC
    LIMIT 12
  `);
  console.table(counts.rows);

  console.log("\n=== MESSAGES SENT WITH NULL TEXT (last 10) ===");
  const empty = await db.execute(sql`
    SELECT
      id, manychat_sub_id, direction, sender, wa_message_id,
      received_at::text AS at,
      length(coalesce(text, '')) AS text_len,
      payload->>'from' AS payload_from,
      payload->>'type' AS payload_type
    FROM messages
    WHERE text IS NULL OR text = ''
    ORDER BY received_at DESC
    LIMIT 10
  `);
  console.table(empty.rows);

  console.log("\n=== LATEST INBOUND VS LATEST OUTBOUND PER LEAD (top 5) ===");
  const lastIn = await db.execute(sql`
    WITH rk AS (
      SELECT
        manychat_sub_id, direction, sender, text, received_at,
        row_number() OVER (PARTITION BY manychat_sub_id, direction ORDER BY received_at DESC) AS rn
      FROM messages
    )
    SELECT manychat_sub_id, direction, sender, text, received_at::text AS at
    FROM rk
    WHERE rn = 1
    ORDER BY received_at DESC
    LIMIT 10
  `);
  console.table(lastIn.rows);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

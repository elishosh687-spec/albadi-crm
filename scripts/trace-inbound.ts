import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("=== last 10 bridge_events ===");
  const ev = await db.execute(sql`
    SELECT evt_id, type, tenant, occurred_at, received_at,
           payload->'message'->>'from' AS msg_from,
           payload->'message'->>'to' AS msg_to,
           payload->'message'->>'text' AS msg_text
    FROM bridge_events
    ORDER BY received_at DESC LIMIT 10
  `);
  console.table(ev.rows ?? ev);

  console.log("\n=== messages from 972525755705 ===");
  const m = await db.execute(sql`
    SELECT id, manychat_sub_id, direction, text, received_at
    FROM messages
    WHERE manychat_sub_id LIKE '%525755705%'
       OR text ILIKE '%525755705%'
    ORDER BY received_at DESC LIMIT 10
  `);
  console.table(m.rows ?? m);

  console.log("\n=== leads matching 525755705 ===");
  const l = await db.execute(sql`
    SELECT manychat_sub_id, name, wa_jid, phone_e164, pipeline_stage, created_at
    FROM leads
    WHERE manychat_sub_id LIKE '%525755705%'
       OR wa_jid LIKE '%525755705%'
       OR phone_e164 LIKE '%525755705%'
    ORDER BY created_at DESC LIMIT 5
  `);
  console.table(l.rows ?? l);
})();

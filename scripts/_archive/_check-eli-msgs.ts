import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT received_at, direction, sender, wa_message_id, substr(text, 1, 100) as text, payload
    FROM messages
    WHERE manychat_sub_id LIKE '%5705%'
       OR manychat_sub_id = '972525755705@s.whatsapp.net'
       OR manychat_sub_id = '972525755705@c.us'
    ORDER BY received_at DESC
    LIMIT 10
  `);
  for (const row of r.rows) console.log(row);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

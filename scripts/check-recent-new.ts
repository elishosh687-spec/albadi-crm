import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("=== leads created in last 1h ===");
  const l = await db.execute(sql`
    SELECT manychat_sub_id, name, wa_jid, phone_e164, pipeline_stage, source, created_at
    FROM leads
    WHERE created_at > NOW() - INTERVAL '1 hour'
    ORDER BY created_at DESC
  `);
  console.table(l.rows ?? l);

  console.log("\n=== messages last 1h ===");
  const m = await db.execute(sql`
    SELECT id, manychat_sub_id, direction, LEFT(text, 60) AS text, received_at
    FROM messages
    WHERE received_at > NOW() - INTERVAL '1 hour'
    ORDER BY received_at DESC
  `);
  console.table(m.rows ?? m);

  console.log("\n=== lead for chat_jid 133144455962747@lid ===");
  const r = await db.execute(sql`
    SELECT * FROM leads WHERE manychat_sub_id = '133144455962747@lid'
  `);
  console.log(JSON.stringify(r.rows ?? r, null, 2));
})();

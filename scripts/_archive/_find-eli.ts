import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT manychat_sub_id, name, phone_e164, wa_jid, ghl_contact_id
    FROM leads
    WHERE phone_e164 LIKE '%5705' OR wa_jid LIKE '%5705%'
    LIMIT 10
  `);
  for (const row of r.rows) console.log(row);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

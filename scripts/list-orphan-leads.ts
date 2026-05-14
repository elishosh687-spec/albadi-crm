import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT manychat_sub_id, name, pipeline_stage, source, created_at
    FROM leads
    WHERE wa_jid IS NULL
    ORDER BY created_at DESC
  `);
  console.log("leads with NULL waJid:", r.rows.length);
  for (const row of r.rows) console.log("  -", JSON.stringify(row));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

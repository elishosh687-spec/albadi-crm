import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function main() {
  const msgs = await db.execute(sql`
    SELECT direction, left(text, 100) AS t, payload->>'kind' AS kind, received_at
    FROM messages WHERE manychat_sub_id = 'playground:bot'
    ORDER BY id DESC LIMIT 20`);
  console.log("== שיחה (מהחדש לישן) ==");
  for (const r of (msgs as any).rows) console.log(`[${r.direction}] ${r.t?.replace(/\n/g," ⏎ ")}`);
  const lead = await db.execute(sql`
    SELECT pipeline_stage, q_state FROM leads WHERE manychat_sub_id = 'playground:bot'`);
  console.log("\n== qState ==");
  console.log(JSON.stringify((lead as any).rows?.[0], null, 1));
}
main().then(() => process.exit(0));

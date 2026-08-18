import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function main() {
  const r = await db.execute(sql`
    SELECT id, manychat_sub_id AS sid, trigger, intent, goal,
           left(draft_text, 80) AS draft, validation, created_at
    FROM setter_decisions
    WHERE manychat_sub_id LIKE 'playground%' AND created_at > now() - interval '2 hours'
    ORDER BY id DESC LIMIT 6`);
  for (const row of (r as any).rows) console.log(JSON.stringify(row, null, 0), "\n---");
  const msgs = await db.execute(sql`
    SELECT direction, sender, left(text,60) AS t, received_at
    FROM messages WHERE manychat_sub_id = 'playground:bot'
    ORDER BY id DESC LIMIT 6`);
  console.log("== playground messages ==");
  for (const row of (msgs as any).rows) console.log(JSON.stringify(row));
}
main().then(() => process.exit(0));

import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const sids = ["181703406538760@lid", "status@broadcast"];
  for (const sid of sids) {
    console.log(`wiping ${sid}`);
    await db.execute(sql`DELETE FROM eli_decisions WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM pipeline_suggestions WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM analysis_queue WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM lead_tags WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM messages WHERE manychat_sub_id = ${sid}`);
    await db.execute(sql`DELETE FROM bridge_events WHERE payload->'data'->>'chat_jid' = ${sid}`);
    await db.execute(sql`DELETE FROM leads WHERE manychat_sub_id = ${sid}`);
  }
  const counts = await db.execute(sql`
    SELECT (SELECT count(*) FROM leads) AS leads,
           (SELECT count(*) FROM messages) AS messages,
           (SELECT count(*) FROM bridge_events) AS evts
  `);
  console.log("after:", (counts as any).rows ?? counts);
}
main().catch(e => { console.error(e); process.exit(1); });

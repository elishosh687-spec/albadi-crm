import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

const PHONE_PART = "504265054"; // matches 972504265054 / 0504265054 etc
const KNOWN_LID = "181703406538760@lid";

async function main() {
  const rows = await db.execute(sql`
    SELECT manychat_sub_id, wa_jid, phone_e164, name, pipeline_stage
    FROM leads
    WHERE manychat_sub_id LIKE ${"%" + PHONE_PART + "%"}
       OR wa_jid LIKE ${"%" + PHONE_PART + "%"}
       OR phone_e164 LIKE ${"%" + PHONE_PART + "%"}
       OR manychat_sub_id = ${KNOWN_LID}
  `);
  const found = ((rows as any).rows ?? rows) as Array<{ manychat_sub_id: string }>;
  console.log("found leads:", found);

  const sids = new Set<string>([KNOWN_LID]);
  for (const r of found) sids.add(r.manychat_sub_id);

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

  const after = await db.execute(sql`
    SELECT (SELECT count(*) FROM leads) AS leads,
           (SELECT count(*) FROM messages) AS messages,
           (SELECT count(*) FROM bridge_events) AS evts
  `);
  console.log("after:", (after as any).rows ?? after);
}

main().catch(e => { console.error(e); process.exit(1); });

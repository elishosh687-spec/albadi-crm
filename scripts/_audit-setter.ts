/** Scratch, read-only: what the setter actually said in the last N days. */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

const DAYS = Number(process.env.DAYS ?? 4);

async function q(text: string) {
  const res: any = await db.execute(sql.raw(text));
  return (res.rows ?? res) as any[];
}

async function main() {
  console.log(`\n=== 1. הודעות יוצאות עם שעה מוצעת (${DAYS} ימים) ===`);
  const times = await q(`
    SELECT m.received_at AT TIME ZONE 'Asia/Jerusalem' AS at_il, m.manychat_sub_id AS sid,
           l.name, m.sender, m.text
    FROM messages m LEFT JOIN leads l ON trim(l.manychat_sub_id)=trim(m.manychat_sub_id)
    WHERE m.direction='out' AND m.received_at > now() - interval '${DAYS} days'
      AND m.text ~ '[0-9]{1,2}:[0-9]{2}'
    ORDER BY m.received_at`);
  for (const r of times) {
    console.log(`\n[${String(r.at_il).slice(0,16)}] ${r.name ?? "?"} (${r.sid}) sender=${r.sender}`);
    console.log("   " + String(r.text).replace(/\n/g, "\n   ").slice(0, 400));
  }
  console.log(`\nסה"כ ${times.length} הודעות עם שעה.`);

  console.log(`\n=== 2. setter_decisions אחרונות ===`);
  const dec = await q(`
    SELECT created_at AT TIME ZONE 'Asia/Jerusalem' AS at_il, lead_sid, goal, skills,
           intent, sent, left(coalesce(draft_text,''),220) AS draft
    FROM setter_decisions
    WHERE created_at > now() - interval '${DAYS} days'
    ORDER BY created_at DESC LIMIT 60`);
  for (const r of dec) {
    console.log(`[${String(r.at_il).slice(0,16)}] ${r.lead_sid} goal=${r.goal} intent=${r.intent} sent=${r.sent} skills=${JSON.stringify(r.skills)}`);
    if (r.draft) console.log("   → " + String(r.draft).replace(/\n/g, " ⏎ "));
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // latest verdict per lead, only followup promised&&!delivered
  const res = await db.execute(sql`
    SELECT DISTINCT ON (a.manychat_sub_id) a.manychat_sub_id AS sid, a.verdict, l.name
    FROM lead_analyses a JOIN leads l ON l.manychat_sub_id = a.manychat_sub_id
    ORDER BY a.manychat_sub_id, a.created_at DESC
  `);
  const flagged = (res.rows as any[])
    .map((r) => ({ sid: r.sid, name: r.name, v: r.verdict as any }))
    .filter((x) => x.v.followup_verdict?.promised && !x.v.followup_verdict?.delivered);

  console.log(`flagged promised-not-delivered: ${flagged.length}\n`);

  let quoteWasSent = 0, lastOutBot = 0, lastOutEli = 0, noOutbound = 0;

  for (const f of flagged) {
    // did we actually send a quote?
    const q = await db.execute(sql`SELECT COUNT(*) n, MAX(sent_at) last FROM bot_quotes WHERE lead_sid = ${f.sid}`);
    const nQuotes = Number((q.rows[0] as any).n);
    // last outbound message sender + when
    const m = await db.execute(sql`
      SELECT sender, direction, text, received_at FROM messages
      WHERE manychat_sub_id = ${f.sid} AND direction = 'out'
      ORDER BY received_at DESC LIMIT 1
    `);
    const lastOut = m.rows[0] as any;
    // last inbound (customer) time
    const ci = await db.execute(sql`
      SELECT MAX(received_at) last FROM messages WHERE manychat_sub_id = ${f.sid} AND direction='in'
    `);
    if (nQuotes > 0) quoteWasSent++;
    if (!lastOut) noOutbound++;
    else if (lastOut.sender === "eli") lastOutEli++;
    else lastOutBot++;

    if (flagged.indexOf(f) < 12) {
      console.log(`• ${f.name} | quotes_sent=${nQuotes} | last_outbound_by=${lastOut?.sender ?? "NONE"}`);
      console.log(`    gap_days=${f.v.followup_verdict?.gap_days} | last_out: "${(lastOut?.text ?? "").slice(0,70)}"`);
    }
  }

  console.log(`\n=== SUMMARY of ${flagged.length} flagged ===`);
  console.log(`  actually HAD a quote sent (bot_quotes>0): ${quoteWasSent}`);
  console.log(`  last outbound was BOT: ${lastOutBot}`);
  console.log(`  last outbound was ELI: ${lastOutEli}`);
  console.log(`  never any outbound: ${noOutbound}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

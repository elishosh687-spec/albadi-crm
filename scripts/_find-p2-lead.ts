import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const fq = await sql`
    SELECT manychat_sub_id, product_spec, created_at
    FROM factory_quote_requests WHERE quotation_no = 'P2WXR65R'
  `;
  const sid = (fq[0] as any).manychat_sub_id;
  console.log("sid:", sid);
  console.log("product_spec:", JSON.stringify((fq[0] as any).product_spec, null, 2));

  const lead = await sql`
    SELECT name, phone_e164, pipeline_stage, q_state, bot_summary
    FROM leads WHERE trim(manychat_sub_id) = ${sid}
  `;
  console.log("\nlead:", JSON.stringify(lead[0], null, 2));

  const bq = await sql`
    SELECT quote_json, created_at FROM bot_quotes
    WHERE lead_sid = ${sid} ORDER BY created_at DESC LIMIT 5
  `;
  console.log(`\nbot_quotes (${bq.length}):`);
  for (const q of bq as any[]) console.log(JSON.stringify(q.quote_json));

  const msgs = await sql`
    SELECT sender, text, created_at FROM messages
    WHERE manychat_sub_id = ${sid} ORDER BY created_at ASC
  `;
  console.log(`\nmessages (${msgs.length}) — customer only mentioning qty/size:`);
  for (const m of msgs as any[]) {
    const t = (m.text ?? "").trim();
    if (/\d{3,}|כמות|יחיד|מידה|גודל|ס"מ|סמ/.test(t)) {
      console.log(`  [${m.sender}] ${t.slice(0, 140)}`);
    }
  }
  process.exit(0);
}
main();

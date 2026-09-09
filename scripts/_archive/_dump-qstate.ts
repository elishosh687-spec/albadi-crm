import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
(async () => {
  const sid = '972528505001@s.whatsapp.net';
  const l = await sql`SELECT q_state, quote_total, quote_alt FROM leads WHERE trim(manychat_sub_id)=${sid}`;
  console.log("q_state:", JSON.stringify(l[0].q_state, null, 1));
  console.log("quote_total:", l[0].quote_total, "| quote_alt:", l[0].quote_alt);
  const q = await sql`SELECT id, source, quote_total_ils, q_state->>'quantity' qty,
    to_char(sent_at AT TIME ZONE 'Asia/Jerusalem','DD/MM HH24:MI:SS') t
    FROM bot_quotes WHERE trim(lead_sid)=${sid} ORDER BY id`;
  console.log("\nbot_quotes:");
  console.table(q);
})();

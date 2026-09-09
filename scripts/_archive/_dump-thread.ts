import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const sid = process.argv[2];
(async () => {
  const rows = await sql`
    SELECT to_char(received_at AT TIME ZONE 'Asia/Jerusalem','DD/MM HH24:MI:SS') t,
           direction, coalesce(sender,'?') s, coalesce(text,'[media]') text
    FROM messages WHERE trim(manychat_sub_id) = ${sid}
    ORDER BY received_at`;
  console.log(`${rows.length} messages\n`);
  for (const r of rows as any[]) {
    const who = r.direction === "in" ? "👤 לקוח" : `🤖 ${r.s}`;
    console.log(`${r.t}  ${who}\n${r.text}\n`);
  }
})();

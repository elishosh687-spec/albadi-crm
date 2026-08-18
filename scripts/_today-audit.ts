import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
(async () => {
  console.log("=== outbound messages today, by sender ===");
  console.table(await sql`
    SELECT coalesce(sender,'?') s, count(*)::int n,
           count(DISTINCT manychat_sub_id)::int leads
    FROM messages
    WHERE direction='out' AND received_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
    GROUP BY 1 ORDER BY n DESC`);

  console.log("\n=== did ANY parked-bucket message go out? (must be 0) ===");
  console.table(await sql`
    SELECT count(*)::int n FROM messages
    WHERE direction='out' AND received_at > now() - interval '24 hours'
      AND text LIKE '%הסר%' AND text LIKE '%אטריד%'`);

  console.log("\n=== every outbound today, newest first ===");
  const rows = await sql`
    SELECT to_char(m.received_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI') t,
           coalesce(m.sender,'?') s,
           coalesce(left(l.name,16),'-') who,
           coalesce(l.pipeline_stage,'(שאלון)') stage,
           left(replace(coalesce(m.text,'[media]'), chr(10), ' | '), 95) txt
    FROM messages m LEFT JOIN leads l ON trim(l.manychat_sub_id)=trim(m.manychat_sub_id)
    WHERE m.direction='out'
      AND m.received_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
    ORDER BY m.received_at DESC`;
  console.log(`total ${rows.length}`);
  for (const r of rows as any[]) console.log(`${r.t} [${r.s}] ${r.who} · ${r.stage}\n     ${r.txt}`);
})();

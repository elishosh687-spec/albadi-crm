import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
(async () => {
  console.log("=== 1. the opt-out-footer message: which loop sent it? ===");
  const f = await sql`
    SELECT to_char(m.received_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI') t,
           l.name, l.pipeline_stage stage, l.follow_up_count fu, m.text
    FROM messages m JOIN leads l ON trim(l.manychat_sub_id)=trim(m.manychat_sub_id)
    WHERE m.direction='out' AND m.received_at > now() - interval '24 hours'
      AND m.text LIKE '%אטריד%'`;
  for (const r of f as any[]) console.log(`${r.t} · ${r.name} · stage=${r.stage} · fu=${r.fu}\n${r.text}\n`);

  console.log("=== 2. messages sent to WON/LOST leads today ===");
  console.table(await sql`
    SELECT to_char(m.received_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI') t,
           coalesce(m.sender,'?') s, l.name, l.pipeline_stage stage,
           left(replace(m.text, chr(10),' | '),60) txt
    FROM messages m JOIN leads l ON trim(l.manychat_sub_id)=trim(m.manychat_sub_id)
    WHERE m.direction='out' AND l.pipeline_stage IN ('WON','LOST')
      AND m.received_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
    ORDER BY m.received_at`);

  console.log("=== 3. duplicate identical outbound within 5 min today ===");
  console.table(await sql`
    SELECT l.name, left(replace(m.text, chr(10),' | '),55) txt, count(*)::int n,
           to_char(min(m.received_at) AT TIME ZONE 'Asia/Jerusalem','HH24:MI') first,
           to_char(max(m.received_at) AT TIME ZONE 'Asia/Jerusalem','HH24:MI') last
    FROM messages m JOIN leads l ON trim(l.manychat_sub_id)=trim(m.manychat_sub_id)
    WHERE m.direction='out' AND m.sender='bot'
      AND m.received_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
    GROUP BY 1, m.text HAVING count(*) > 1
    ORDER BY n DESC`);

  console.log("=== 4. the 09:54 burst — what fired ===");
  console.table(await sql`
    SELECT to_char(m.received_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI:SS') t,
           l.name, l.pipeline_stage stage, l.follow_up_count fu,
           left(replace(m.text, chr(10),' | '),70) txt
    FROM messages m JOIN leads l ON trim(l.manychat_sub_id)=trim(m.manychat_sub_id)
    WHERE m.direction='out' AND m.sender='bot'
      AND m.received_at AT TIME ZONE 'Asia/Jerusalem' BETWEEN
          (current_date + time '09:40') AND (current_date + time '10:10')
    ORDER BY m.received_at`);
})();

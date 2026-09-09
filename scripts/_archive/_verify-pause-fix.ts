import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
(async () => {
  const lock = await sql`SELECT value->>'at' AS at, updated_at FROM app_config WHERE key='followups.lock'`;
  console.log("followups last ran:", lock[0]?.updated_at);

  console.log("\n=== drifted leads (bot_paused=false + a live reason) ===");
  console.table(await sql`
    SELECT left(name,20) name, coalesce(pipeline_stage,'-') stage, bot_pause_reason reason,
           follow_up_count fu, pipeline_flag flag,
           to_char(updated_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI') upd
    FROM leads WHERE active AND bot_paused=false AND bot_pause_reason IS NOT NULL
    ORDER BY updated_at DESC`);

  console.log("\n=== escalation DMs to Eli's number since the fix deployed ===");
  console.table(await sql`
    SELECT to_char(received_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI') t,
           left(replace(text, chr(10),' | '),60) txt
    FROM messages
    WHERE direction='out' AND text LIKE '%קר אחרי%'
      AND received_at > now() - interval '3 hours'
    ORDER BY received_at DESC`);

  console.log("\n=== opt_out leads: all still muted? ===");
  console.table(await sql`
    SELECT bot_paused, count(*)::int n FROM leads
    WHERE active AND bot_pause_reason='opt_out' GROUP BY 1`);
})();

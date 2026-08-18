import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
(async () => {
  console.log("=== leads UN-paused by GHL but still carrying a pause reason ===");
  console.log("(bot_paused=false while bot_pause_reason is set = the pause was wiped)");
  console.table(await sql`
    SELECT bot_pause_reason reason, count(*)::int n,
           count(*) FILTER (WHERE coalesce(pipeline_stage,'') NOT IN ('WON','LOST'))::int still_active
    FROM leads
    WHERE active AND bot_paused = false AND bot_pause_reason IS NOT NULL
    GROUP BY 1 ORDER BY n DESC`);

  console.log("\n=== how many are still paused, for comparison ===");
  console.table(await sql`
    SELECT bot_pause_reason reason, count(*)::int n
    FROM leads WHERE active AND bot_paused = true AND bot_pause_reason IS NOT NULL
    GROUP BY 1 ORDER BY n DESC`);

  console.log("\n=== the opt-out lead in the parked bucket: is the gate still protecting it? ===");
  console.table(await sql`
    SELECT trim(manychat_sub_id) sid, name, pipeline_stage stage,
           bot_paused, bot_pause_reason reason
    FROM leads WHERE active AND pipeline_stage='FUTURE_FOLLOW_UP'
      AND bot_pause_reason IS NOT NULL`);

  console.log("\n=== any opt_out lead NOT protected by a terminal stage? ===");
  console.table(await sql`
    SELECT trim(manychat_sub_id) sid, left(name,20) name, coalesce(pipeline_stage,'(שאלון)') stage,
           bot_paused
    FROM leads
    WHERE active AND bot_pause_reason = 'opt_out'
      AND coalesce(pipeline_stage,'') NOT IN ('WON','LOST')
    ORDER BY bot_paused`);
})();

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const sid = '972526510881@s.whatsapp.net';
(async () => {
  const l = await sql`SELECT q_state, pipeline_stage, bot_paused, bot_pause_reason,
    to_char(bot_paused_at AT TIME ZONE 'Asia/Jerusalem','DD/MM HH24:MI') paused_at,
    quote_total, follow_up_count, last_follow_up_at
    FROM leads WHERE trim(manychat_sub_id)=${sid}`;
  console.log("lead:", JSON.stringify(l[0], null, 1));

  console.log("\n=== decision log for this lead ===");
  console.table(await sql`
    SELECT to_char(created_at AT TIME ZONE 'Asia/Jerusalem','DD/MM HH24:MI') t,
           decided_by, action, stage_before, left(coalesce(reply_text,''),50) reply
    FROM bot_decision_log WHERE trim(manychat_sub_id)=${sid} ORDER BY created_at`);

  console.log("\n=== setter decisions for this lead ===");
  console.table(await sql`
    SELECT to_char(created_at AT TIME ZONE 'Asia/Jerusalem','DD/MM HH24:MI') t,
           trigger, intent, goal, left(coalesce(draft_text,'<null>'),55) draft
    FROM setter_decisions WHERE trim(manychat_sub_id)=${sid} ORDER BY created_at`);
})();

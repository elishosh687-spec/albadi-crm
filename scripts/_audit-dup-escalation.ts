import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
(async () => {
  console.log("=== leads that got a DOUBLE escalation DM today ===");
  const names = ['נדב לב - מחבר אנשים לעצמם במוזיקה וצלילים', 'אשר פרץ'];
  for (const n of names) {
    const r = await sql`
      SELECT trim(manychat_sub_id) sid, name, pipeline_stage stage, pipeline_flag flag,
             bot_paused, bot_pause_reason reason, bot_pause_sticky sticky,
             follow_up_count fu, bot_paused_at, updated_at
      FROM leads WHERE name = ${n}`;
    console.log(JSON.stringify(r[0], null, 1));
  }

  console.log("\n=== escalation decisions logged today ===");
  console.table(await sql`
    SELECT to_char(created_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI:SS') t,
           manychat_sub_id sid, action, escalation_kind, stage_before,
           metadata->>'attempt' attempt
    FROM bot_decision_log
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
      AND action = 'escalated'
    ORDER BY created_at`);

  console.log("\n=== the two LOST leads: when did the stage change vs the send? ===");
  console.table(await sql`
    SELECT name, pipeline_stage stage, bot_paused, coalesce(bot_pause_reason,'-') reason,
           follow_up_count fu,
           to_char(updated_at AT TIME ZONE 'Asia/Jerusalem','DD/MM HH24:MI') lead_updated,
           to_char(bot_paused_at AT TIME ZONE 'Asia/Jerusalem','DD/MM HH24:MI') paused_at
    FROM leads WHERE name IN ('נטלי בן נעים','אשר פרץ')`);

  console.log("\n=== stage_change events today (who moved what) ===");
  console.table(await sql`
    SELECT to_char(created_at AT TIME ZONE 'Asia/Jerusalem','HH24:MI') t,
           manychat_sub_id sid, payload->>'from' AS from_s, payload->>'to' AS to_s
    FROM lead_events
    WHERE event_type='stage_change'
      AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
    ORDER BY created_at`);
})();

import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const q = process.argv[2] ?? "";
(async () => {
  const rows = await sql`
    SELECT trim(manychat_sub_id) sid, name, phone_e164 phone,
           coalesce(pipeline_stage,'(שאלון)') stage, bot_paused,
           coalesce(bot_pause_reason,'-') reason, follow_up_count fu,
           quote_total, q_state->>'step' step, q_state->>'subFlow' subflow,
           to_char(updated_at AT TIME ZONE 'Asia/Jerusalem','DD/MM HH24:MI') upd
    FROM leads
    WHERE name ILIKE ${'%' + q + '%'} OR phone_e164 ILIKE ${'%' + q + '%'}
    ORDER BY updated_at DESC LIMIT 12`;
  console.table(rows);
})();

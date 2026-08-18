/**
 * Clear pause reasons left on leads that are no longer paused.
 *
 * A reason without a pause is a lie: the state reads "muted because they
 * asked us to stop" while the bot is free to talk. These are the residue of
 * the GHL write sites setting `bot_paused` bare (fixed 2026-08-18) — from now
 * on an un-pause clears them, so this is a one-time sweep of what drifted.
 *
 * Refuses to touch an irrevocable reason: if an opt_out row ever shows up
 * un-paused, the answer is to restore the pause, not to erase the evidence.
 */
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const GO = process.argv.includes("--go");

(async () => {
  const rows = await sql`
    SELECT trim(manychat_sub_id) sid, left(name,22) name,
           coalesce(pipeline_stage,'-') stage, bot_pause_reason reason
    FROM leads WHERE active AND bot_paused = false AND bot_pause_reason IS NOT NULL
    ORDER BY bot_pause_reason`;
  console.table(rows);

  const irrevocable = (rows as any[]).filter((r) =>
    r.reason === "opt_out" || r.reason === "human_handoff");
  if (irrevocable.length) {
    console.error(
      `\n⚠️  ${irrevocable.length} un-paused lead(s) carry an irrevocable reason. ` +
      "Those need the PAUSE restored, not the reason cleared. Aborting."
    );
    process.exit(1);
  }

  if (!GO) { console.log("\nDRY RUN — pass --go to clear."); return; }

  const upd = await sql`
    UPDATE leads SET bot_pause_reason = NULL, bot_paused_at = NULL, updated_at = now()
    WHERE active AND bot_paused = false AND bot_pause_reason IS NOT NULL
      AND bot_pause_reason NOT IN ('opt_out','human_handoff')
    RETURNING trim(manychat_sub_id) sid`;
  console.log(`\ncleared ${upd.length} ghost reason(s).`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

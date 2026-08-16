/**
 * Adds the bot-pause bookkeeping columns and classifies the rows that predate
 * them. Direct DDL — `drizzle-kit push` hangs on this project (orphan
 * configurator_* tables trigger a create-vs-rename TUI prompt).
 *
 * Backfill logic: a pause already on the books has no recorded cause, but the
 * lead's own state usually betrays it. An opt-out is written as LOST +
 * loss_reason, and a won deal as WON — both are pauses that must NEVER expire.
 * Everything else is marked `legacy`, which is deliberately NOT auto-resumable:
 * these leads are released only when Eli asks for it, so turning the feature on
 * can't silently un-mute months of backlog in one sweep.
 *
 * Idempotent — safe to re-run.
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const go = process.argv.includes("--go");

  console.log("=== current state ===");
  const before = await db.execute(sql`
    SELECT count(*) FILTER (WHERE bot_paused) AS paused,
           count(*) AS total
    FROM leads WHERE active IS NOT FALSE`);
  console.log(JSON.stringify(((before as any).rows ?? before)[0]));

  if (!go) {
    console.log("\n--- dry run. Re-run with --go to apply. ---");
    const preview = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE pipeline_stage = 'LOST' OR loss_reason IS NOT NULL) AS would_be_opt_out,
        count(*) FILTER (WHERE pipeline_stage = 'WON') AS would_be_won,
        count(*) FILTER (WHERE pipeline_stage NOT IN ('LOST','WON') OR pipeline_stage IS NULL) AS would_be_legacy
      FROM leads WHERE bot_paused AND active IS NOT FALSE`);
    console.log(JSON.stringify(((preview as any).rows ?? preview)[0], null, 2));
    return;
  }

  console.log("\n=== adding columns ===");
  await db.execute(sql`
    ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS bot_paused_at timestamptz,
      ADD COLUMN IF NOT EXISTS bot_pause_reason text,
      ADD COLUMN IF NOT EXISTS bot_pause_sticky boolean NOT NULL DEFAULT false`);
  console.log("columns ok");

  // Index the sweep's exact predicate — it runs hourly over the whole table.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS leads_bot_pause_sweep_idx
      ON leads (bot_paused, bot_pause_sticky, bot_paused_at)
      WHERE bot_paused`);
  console.log("index ok");

  console.log("\n=== backfilling rows paused before the columns existed ===");
  // Opt-outs and won deals first — these must never auto-resume, so they get
  // their true reason rather than the neutral `legacy`.
  const optOut = await db.execute(sql`
    UPDATE leads SET bot_pause_reason = 'opt_out', bot_paused_at = COALESCE(bot_paused_at, updated_at)
    WHERE bot_paused AND bot_pause_reason IS NULL
      AND (pipeline_stage = 'LOST' OR loss_reason IS NOT NULL)`);
  console.log("marked opt_out:", (optOut as any).rowCount ?? "?");

  const won = await db.execute(sql`
    UPDATE leads SET bot_pause_reason = 'deal_won', bot_paused_at = COALESCE(bot_paused_at, updated_at)
    WHERE bot_paused AND bot_pause_reason IS NULL AND pipeline_stage = 'WON'`);
  console.log("marked deal_won:", (won as any).rowCount ?? "?");

  const legacy = await db.execute(sql`
    UPDATE leads SET bot_pause_reason = 'legacy', bot_paused_at = COALESCE(bot_paused_at, updated_at)
    WHERE bot_paused AND bot_pause_reason IS NULL`);
  console.log("marked legacy:", (legacy as any).rowCount ?? "?");

  console.log("\n=== result ===");
  const after = await db.execute(sql`
    SELECT bot_pause_reason, count(*) AS leads
    FROM leads WHERE bot_paused AND active IS NOT FALSE
    GROUP BY 1 ORDER BY 2 DESC`);
  for (const r of (after as any).rows ?? after) console.log(JSON.stringify(r));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

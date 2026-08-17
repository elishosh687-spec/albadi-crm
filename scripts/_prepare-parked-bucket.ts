/**
 * One-time preparation of the "להתקשר בעתיד" bucket before its loop is enabled.
 *
 * Two independent fixes, both scoped to `pipeline_stage = 'FUTURE_FOLLOW_UP'`:
 *
 * 1. RESET THE FOLLOW-UP CLOCK on every lead already parked there.
 *    `enterFutureFollowUp` now does this on entry, but the 45 leads already in
 *    the stage were dragged there before it existed and still carry the counter
 *    from whatever loop they came out of. Measured 2026-08-17: of the 21 the
 *    bot can actually reach, only 5 start clean — 9 sit at 2 and 4 sit at 3, so
 *    with a cap of 4 those four would get ONE nudge and then escalate. The
 *    stage would look like it was working while doing almost nothing.
 *    Nobody has ever received a FUTURE_FOLLOW_UP message (the rule is new), so
 *    every one of these counts belongs to a different, finished loop.
 *
 * 2. RELEASE THE `legacy` PAUSES in this stage (Eli's decision, 17.8).
 *    `legacy` is the reason backfilled onto rows muted before the pause
 *    lifecycle existed — cause unknown. 23 of them sit here, half the bucket.
 *    SCOPED TO THIS STAGE ON PURPOSE: ~46 more legacy pauses live in other
 *    stages and are still an open question. Releasing those would be answering
 *    something he wasn't asked.
 *
 * Dry by default. Pass --go to write.
 *
 *   DATABASE_URL="$(neonctl connection-string …)" npx tsx scripts/_prepare-parked-bucket.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const GO = process.argv.includes("--go");

const PARKED = "FUTURE_FOLLOW_UP";

async function main() {
  console.log("=== 1. leads whose follow-up clock is stale ===");
  const stale = await sql`
    SELECT trim(manychat_sub_id) AS sid, name, follow_up_count AS fu,
           bot_paused, coalesce(bot_pause_reason, '-') AS reason
    FROM leads
    WHERE active = true AND pipeline_stage = ${PARKED}
      AND (follow_up_count > 0 OR last_follow_up_at IS NOT NULL)
    ORDER BY follow_up_count DESC`;
  console.log(`${stale.length} lead(s) carry a counter from a previous loop:`);
  console.table(stale.slice(0, 25));

  console.log("\n=== 2. legacy-paused leads in this stage ===");
  const legacy = await sql`
    SELECT trim(manychat_sub_id) AS sid, name,
           (manychat_sub_id IN (SELECT lead_sid FROM bot_quotes)) AS quoted,
           (SELECT max(received_at) FROM messages m
             WHERE trim(m.manychat_sub_id) = trim(leads.manychat_sub_id)
               AND m.sender = 'lead')::date AS last_in
    FROM leads
    WHERE active = true AND pipeline_stage = ${PARKED}
      AND bot_paused = true AND bot_pause_reason = 'legacy'
    ORDER BY last_in DESC NULLS LAST`;
  console.log(`${legacy.length} lead(s) muted by an untraceable old pause:`);
  console.table(legacy);

  if (!GO) {
    console.log(
      "\nDRY RUN — pass --go to reset the clocks and release the legacy pauses."
    );
    return;
  }

  // 1. Fresh loop, fresh counter. Also stamps parkedAt so these leads look
  //    identical to ones parked from now on.
  const reset = await sql`
    UPDATE leads
    SET follow_up_count = 0,
        last_follow_up_at = NULL,
        q_state = coalesce(q_state, '{}'::jsonb)
                  || jsonb_build_object('parkedAt', now()::text, 'parkedVia', 'backfill'),
        updated_at = now()
    WHERE active = true AND pipeline_stage = ${PARKED}
    RETURNING trim(manychat_sub_id) AS sid`;
  console.log(`\nreset the clock on ${reset.length} parked lead(s).`);

  // 2. resumeFields() semantics. follow_up_count is already zeroed above — it
  //    has to be, or the first nudge trips the attempt cap and re-mutes the
  //    lead instantly.
  const released = await sql`
    UPDATE leads
    SET bot_paused = false,
        bot_paused_at = NULL,
        bot_pause_reason = NULL,
        bot_pause_sticky = false,
        updated_at = now()
    WHERE active = true AND pipeline_stage = ${PARKED}
      AND bot_paused = true AND bot_pause_reason = 'legacy'
    RETURNING trim(manychat_sub_id) AS sid`;
  console.log(`released ${released.length} legacy-paused lead(s).`);

  const [after] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE NOT bot_paused)::int AS reachable
    FROM leads WHERE active = true AND pipeline_stage = ${PARKED}`;
  console.log(
    `\nbucket now: ${after.total} leads, ${after.reachable} reachable. ` +
      "Still silent until futureFollowupEnabled is switched on in the settings."
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

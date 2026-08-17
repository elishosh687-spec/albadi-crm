/**
 * Release the `legacy`-paused leads sitting in "להתקשר בעתיד".
 *
 * `legacy` is the pause reason backfilled onto rows that were muted before the
 * pause lifecycle existed — cause unknown, nobody remembers. System-wide there
 * are ~69 of them; **23 sit in the parked bucket**, which is half of it. Until
 * they are released the new follow-up loop can reach only 19 of 45 leads.
 *
 * SCOPED TO THIS STAGE ON PURPOSE. Eli's 17.8 decision was about the parked
 * leads he was looking at; the other ~46 legacy pauses live in other stages and
 * are still an open question. Releasing them all would be answering a question
 * he wasn't asked.
 *
 * Dry by default. Pass --go to write.
 *
 *   DATABASE_URL="$(neonctl connection-string …)" npx tsx scripts/_release-legacy-in-parked.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const GO = process.argv.includes("--go");

async function main() {
  const rows = await sql`
    SELECT trim(manychat_sub_id) AS sid,
           name,
           follow_up_count,
           bot_pause_sticky,
           (manychat_sub_id IN (SELECT lead_sid FROM bot_quotes)) AS quoted,
           (SELECT max(received_at) FROM messages m
             WHERE trim(m.manychat_sub_id) = trim(leads.manychat_sub_id)
               AND m.sender = 'lead')::date AS last_in
    FROM leads
    WHERE active = true
      AND pipeline_stage = 'FUTURE_FOLLOW_UP'
      AND bot_paused = true
      AND bot_pause_reason = 'legacy'
    ORDER BY last_in DESC NULLS LAST`;

  console.log(`${rows.length} legacy-paused lead(s) in FUTURE_FOLLOW_UP:`);
  console.table(rows);
  if (!rows.length) return;

  if (!GO) {
    console.log("\nDRY RUN — pass --go to release them.");
    return;
  }

  // resumeFields() semantics, plus the two bookkeeping fields a resume must
  // reset: follow_up_count (or the first nudge trips the attempt cap and
  // re-mutes the lead instantly) and bot_pause_sticky.
  const upd = await sql`
    UPDATE leads
    SET bot_paused = false,
        bot_paused_at = NULL,
        bot_pause_reason = NULL,
        bot_pause_sticky = false,
        follow_up_count = 0,
        last_follow_up_at = NULL,
        updated_at = now()
    WHERE active = true
      AND pipeline_stage = 'FUTURE_FOLLOW_UP'
      AND bot_paused = true
      AND bot_pause_reason = 'legacy'
    RETURNING trim(manychat_sub_id) AS sid`;

  console.log(`\nreleased ${upd.length} lead(s).`);
  console.log(
    "They are now reachable by the parked follow-up loop — which still does " +
      "nothing until futureFollowupEnabled is switched on in the settings."
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

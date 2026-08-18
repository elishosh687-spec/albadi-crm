/**
 * Scratch — prove the resume sweep picks exactly the right leads.
 *
 * This decides which real customers start hearing from a bot again, so the
 * refusals matter more than the releases. Uses disposable `sweeptest:` leads,
 * then cleans up.
 */
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { sql } from "drizzle-orm";
import { runResumeSweep } from "../lib/autoresponder/resume-sweep";
import { getBotSettings } from "../lib/bot-settings/store";

const CASES: {
  sid: string;
  reason: string;
  ageHours: number;
  sticky: boolean;
  shouldResume: boolean;
  why: string;
}[] = [
  { sid: "sweeptest:human-old", reason: "human_reply", ageHours: 100, sticky: false, shouldResume: true, why: "a human took over, long ago — the 81-lead case" },
  { sid: "sweeptest:human-fresh", reason: "human_reply", ageHours: 1, sticky: false, shouldResume: false, why: "Eli is still in this conversation right now" },
  { sid: "sweeptest:escalation", reason: "escalation", ageHours: 100, sticky: false, shouldResume: true, why: "escalation is temporary by design" },
  { sid: "sweeptest:logo", reason: "logo_received", ageHours: 100, sticky: false, shouldResume: true, why: "logo handled, bot may follow up again" },
  { sid: "sweeptest:reengage", reason: "reengagement_reply", ageHours: 100, sticky: false, shouldResume: true, why: "customer re-engaged" },
  { sid: "sweeptest:optout", reason: "opt_out", ageHours: 5000, sticky: false, shouldResume: false, why: "THEY ASKED US TO STOP — waking up is a breach" },
  { sid: "sweeptest:handoff", reason: "human_handoff", ageHours: 5000, sticky: false, shouldResume: false, why: "they asked for a person, not a bot" },
  { sid: "sweeptest:won", reason: "deal_won", ageHours: 5000, sticky: false, shouldResume: false, why: "deal is closing by hand" },
  { sid: "sweeptest:noreply", reason: "no_reply", ageHours: 5000, sticky: false, shouldResume: false, why: "went cold — resuming restarts the nagging" },
  { sid: "sweeptest:manual", reason: "manual_toggle", ageHours: 5000, sticky: false, shouldResume: false, why: "Eli flipped it deliberately" },
  { sid: "sweeptest:sticky", reason: "human_reply", ageHours: 5000, sticky: true, shouldResume: false, why: 'marked "don\'t touch this lead"' },
  { sid: "sweeptest:legacy", reason: "legacy", ageHours: 5000, sticky: false, shouldResume: false, why: "pre-tracking backlog — released only on request" },
];

async function seed() {
  for (const c of CASES) {
    await db.execute(sql`
      INSERT INTO leads (manychat_sub_id, name, active, bot_paused, bot_pause_reason, bot_pause_sticky, bot_paused_at, follow_up_count)
      VALUES (${c.sid}, ${"בדיקת שחרור"}, false, true, ${c.reason}, ${c.sticky},
              now() - (${c.ageHours} || ' hours')::interval, 2)
      ON CONFLICT (manychat_sub_id) DO UPDATE SET
        bot_paused = true, bot_pause_reason = EXCLUDED.bot_pause_reason,
        bot_pause_sticky = EXCLUDED.bot_pause_sticky, bot_paused_at = EXCLUDED.bot_paused_at,
        follow_up_count = 2`);
  }
}

async function cleanup() {
  await db.delete(leads).where(sql`${leads.manychatSubId} LIKE 'sweeptest:%'`);
}

async function main() {
  const S = await getBotSettings();
  console.log(`settings: autoResumeEnabled=${S.autoResumeEnabled} autoResumeHours=${S.autoResumeHours}\n`);

  await cleanup();
  await seed();

  const result = await runResumeSweep();
  const resumedSet = new Set(result.resumedSids);

  let fails = 0;
  for (const c of CASES) {
    const got = resumedSet.has(c.sid);
    const pass = got === c.shouldResume;
    if (!pass) fails++;
    const verdict = got ? "RESUMED" : "left paused";
    console.log(`${pass ? "✅" : "❌"} ${c.reason.padEnd(19)} ${String(c.ageHours).padStart(5)}h  → ${verdict.padEnd(12)} ${c.why}`);
  }

  // followUpCount must reset, or the first nudge after waking trips the
  // 3-strike escalation and instantly re-mutes the lead.
  const [row] = await db
    .select({ n: leads.followUpCount, paused: leads.botPaused, reason: leads.botPauseReason })
    .from(leads)
    .where(sql`${leads.manychatSubId} = 'sweeptest:human-old'`);
  const counterOk = row?.n === 0 && row?.paused === false && row?.reason === null;
  if (!counterOk) fails++;
  console.log(`\n${counterOk ? "✅" : "❌"} resumed lead is clean: followUpCount=${row?.n} paused=${row?.paused} reason=${row?.reason}`);

  console.log(`\nlegacy waiting for a deliberate release: ${result.legacyWaiting}`);
  console.log(`skipped because marked "don't touch": ${result.skippedSticky}`);

  await cleanup();
  console.log(fails === 0 ? "\n✅ sweep selects exactly the right leads" : `\n❌ ${fails} failures`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });

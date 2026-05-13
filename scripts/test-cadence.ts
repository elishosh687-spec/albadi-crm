/**
 * Follow-up cadence smoke test — verifies 24h / 36h / 72h pacing for
 * AWAITING_DECISION + escalation after attempt 3.
 *
 * Run:
 *   # Terminal 1 — dev server with bypass + dry-run
 *   $env:BRIDGE_DRY_RUN = "1"; $env:FOLLOWUPS_BYPASS_GATES = "1"; npm run dev
 *
 *   # Terminal 2
 *   $env:BRIDGE_DRY_RUN = "1"; npx tsx scripts/test-cadence.ts
 *
 * Strategy: simulate elapsed time by rewriting `lastFollowUpAt` BEFORE each
 * cron POST. The cron then sees "enough time has passed" relative to the
 * cadence for the current attempt and fires.
 */
process.env.BRIDGE_DRY_RUN = "1";

import "dotenv/config";
import {
  TEST_SID,
  assert,
  ensureDryRun,
  finishAndExit,
  readLead,
  section,
  seedLead,
  updateLastFollowUp,
} from "./test-helpers";

const HOUR_MS = 60 * 60 * 1000;
const CRON_URL = process.env.CRON_URL ?? "http://localhost:3000/api/bot/followups";

function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith("﻿") ? raw.slice(1) : raw;
}

async function callCron(): Promise<unknown> {
  const secret = readEnv("BOT_SECRET");
  if (!secret) {
    console.error("BOT_SECRET missing in env — cron POST will 401.");
    process.exit(2);
  }
  const res = await fetch(CRON_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("cron POST failed", res.status, body);
    throw new Error(`cron HTTP ${res.status}`);
  }
  return body;
}

async function main(): Promise<void> {
  ensureDryRun();

  // Sanity: cron reachable + auth works.
  section("Cron preflight");
  await seedLead({
    stage: "AWAITING_DECISION",
    qState: { step: 9, doneAt: new Date().toISOString() },
    followUpCount: 0,
    lastFollowUpAt: new Date(), // just now — no follow-up should fire
  });
  const pre = (await callCron()) as { skipped?: string; customer?: { by?: Record<string, number> } };
  if (pre.skipped === "quiet_hours" || pre.skipped === "no_send_day") {
    console.error(
      `cron skipped=${pre.skipped}. Start dev server with FOLLOWUPS_BYPASS_GATES=1`
    );
    process.exit(2);
  }
  const r0 = await readLead();
  assert(r0.followUpCount === 0, "no follow-up fires when lastFollowUpAt=now");

  // ----- 1st attempt: 24h cadence -----
  section("1st attempt fires after 24h elapsed");
  await updateLastFollowUp(new Date(Date.now() - 25 * HOUR_MS)); // 25h ago
  await callCron();
  let r = await readLead();
  assert(r.followUpCount === 1, "1st follow-up sent (count 0→1)");

  // ----- 2nd attempt: 36h cadence (rewrite last to 37h ago) -----
  section("2nd attempt fires after 36h elapsed");
  await updateLastFollowUp(new Date(Date.now() - 37 * HOUR_MS));
  await callCron();
  r = await readLead();
  assert(r.followUpCount === 2, "2nd follow-up sent (count 1→2)");

  // ----- Premature: 30h < 72h cadence for attempt 3 -----
  section("3rd attempt does NOT fire after only 30h (need 72h)");
  await updateLastFollowUp(new Date(Date.now() - 30 * HOUR_MS));
  await callCron();
  r = await readLead();
  assert(r.followUpCount === 2, "no fire — 30h < 72h cadence");

  // ----- 3rd attempt: 72h cadence -----
  section("3rd attempt fires after 72h elapsed → escalate");
  await updateLastFollowUp(new Date(Date.now() - 73 * HOUR_MS));
  await callCron();
  r = await readLead();
  assert(r.followUpCount === 3, "3rd follow-up sent (count 2→3)");
  assert(
    r.pipelineFlag === "NEEDS_ELI" && r.botPaused === true,
    "after 3rd follow-up → escalated (NEEDS_ELI + bot_paused)"
  );

  // ----- AWAITING_LOGO uses same cadence -----
  section("AWAITING_LOGO also follows 24h cadence (smoke check)");
  await seedLead({
    stage: "AWAITING_LOGO",
    qState: { step: 9, doneAt: new Date().toISOString() },
    followUpCount: 0,
    lastFollowUpAt: new Date(Date.now() - 25 * HOUR_MS),
  });
  await callCron();
  r = await readLead();
  assert(r.followUpCount === 1, "AWAITING_LOGO: 1st follow-up after 24h");

  // ----- AWAITING_FINAL uses same cadence -----
  section("AWAITING_FINAL also follows 24h cadence (smoke check)");
  await seedLead({
    stage: "AWAITING_FINAL",
    qState: { step: 9, doneAt: new Date().toISOString() },
    followUpCount: 0,
    lastFollowUpAt: new Date(Date.now() - 25 * HOUR_MS),
  });
  await callCron();
  r = await readLead();
  assert(r.followUpCount === 1, "AWAITING_FINAL: 1st follow-up after 24h");

  await finishAndExit("test-cadence");
}

main().catch((e) => {
  console.error("test-cadence crashed:", e);
  process.exit(1);
});

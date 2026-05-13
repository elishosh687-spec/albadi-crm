/**
 * Stage 3 (logo) smoke test.
 *   $env:BRIDGE_DRY_RUN = "1"; npx tsx scripts/test-stage3.ts
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
} from "./test-helpers";
import { handleDecisionInbound } from "../lib/autoresponder/decision";

async function seedAtLogo(extra: Record<string, unknown> = {}): Promise<void> {
  await seedLead({
    stage: "AWAITING_LOGO",
    qState: { step: 9, doneAt: new Date().toISOString(), ...extra },
    botPaused: false,
    pipelineFlag: null,
    followUpCount: 0,
  });
}

async function main(): Promise<void> {
  ensureDryRun();

  // ----- 3.1 media received → IN_PROGRESS + NEEDS_ELI + bot paused -----
  section("3.1 media (file/image) → IN_PROGRESS, NEEDS_ELI, bot paused");
  await seedAtLogo();
  await handleDecisionInbound({ sid: TEST_SID, text: null, hasMedia: true });
  let r = await readLead();
  assert(r.pipelineStage === "IN_PROGRESS", "media → IN_PROGRESS");
  assert(r.pipelineFlag === "NEEDS_ELI", "NEEDS_ELI flag set");
  assert(r.botPaused === true, "bot paused after logo receipt");
  assert(
    typeof r.botSummary === "string" && r.botSummary.includes("logo"),
    "botSummary mentions logo"
  );

  // ----- 3.3 format question → canned reply, no attempt consumed -----
  section("3.3 'באיזה פורמט?' → canned, stage unchanged, followUpCount unchanged");
  await seedAtLogo({ followUpCount: 0 });
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "באיזה פורמט לשלוח את הלוגו?",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.pipelineStage === "AWAITING_LOGO", "format Q stays in AWAITING_LOGO");
  assert(r.followUpCount === 0, "format Q does NOT consume re-ask attempt");
  assert(r.pipelineFlag !== "NEEDS_ELI", "format Q does NOT escalate");

  // ----- 3.4 text-only re-ask × 3 → escalate -----
  section("3.4 text-only re-ask × 3 → escalate at attempt 3");
  await seedAtLogo({ followUpCount: 0 });

  await handleDecisionInbound({
    sid: TEST_SID,
    text: "אעלה אחר כך",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.followUpCount === 1, "1st text re-ask: followUpCount=1");
  assert(r.pipelineFlag !== "NEEDS_ELI", "1st re-ask: not escalated");

  await handleDecisionInbound({
    sid: TEST_SID,
    text: "אין לי עכשיו",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.followUpCount === 2, "2nd text re-ask: followUpCount=2");
  assert(r.pipelineFlag !== "NEEDS_ELI", "2nd re-ask: not escalated");

  await handleDecisionInbound({
    sid: TEST_SID,
    text: "תכין אתה",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.pipelineFlag === "NEEDS_ELI", "3rd re-ask attempt → escalate");
  assert(r.botPaused === true, "bot paused after escalate");

  await finishAndExit("test-stage3");
}

main().catch((e) => {
  console.error("test-stage3 crashed:", e);
  process.exit(1);
});

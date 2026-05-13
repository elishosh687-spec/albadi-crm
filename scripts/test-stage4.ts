/**
 * Stage 4 (final price) smoke test.
 *   $env:BRIDGE_DRY_RUN = "1"; npx tsx scripts/test-stage4.ts
 *
 * Covers:
 *   - sendFinalPrice() dashboard action transitions IN_PROGRESS → AWAITING_FINAL
 *   - 4.1 accept → WON + NEEDS_ELI (Eli closes deal)
 *   - 4.2 reject/negotiating → ask "מה בדיוק?" → next turn → escalate
 *   - 4.3 spec change (custom_size) → escalate
 *   - 4.4 question_payment → canned, stay in AWAITING_FINAL
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
import { sendFinalPrice } from "../app/actions/v2";

async function seedAtFinal(extra: Record<string, unknown> = {}): Promise<void> {
  await seedLead({
    stage: "AWAITING_FINAL",
    qState: { step: 9, doneAt: new Date().toISOString(), ...extra },
    botPaused: false,
    pipelineFlag: null,
    followUpCount: 0,
    quoteTotal: "850",
  });
}

async function main(): Promise<void> {
  ensureDryRun();

  // ----- 4.entry — sendFinalPrice action -----
  section("Entry: sendFinalPrice (dashboard) → IN_PROGRESS → AWAITING_FINAL");
  await seedLead({
    stage: "IN_PROGRESS",
    qState: { step: 9, doneAt: new Date().toISOString() },
    botPaused: true,
    pipelineFlag: "NEEDS_ELI",
    followUpCount: 0,
  });
  const sendRes = await sendFinalPrice(TEST_SID, "850");
  assert(sendRes.ok === true, `sendFinalPrice succeeded: ${sendRes.message ?? sendRes.error}`);

  let r = await readLead();
  assert(r.pipelineStage === "AWAITING_FINAL", "stage → AWAITING_FINAL");
  assert(r.quoteTotal === "850", "quoteTotal stored");
  assert(r.botPaused === false, "bot resumed");
  assert(r.pipelineFlag === null, "NEEDS_ELI cleared");
  assert(r.followUpCount === 0, "followUpCount reset");

  // ----- 4.1 accept → WON -----
  section("4.1 accept → WON");
  await seedAtFinal();
  await handleDecisionInbound({ sid: TEST_SID, text: "מתאים, בוא נסגור", hasMedia: false });
  r = await readLead();
  assert(r.pipelineStage === "WON", "accept final → WON");
  assert(r.pipelineFlag === "NEEDS_ELI", "WON sets NEEDS_ELI for Eli to close");
  assert(r.botPaused === true, "bot paused after WON");

  // ----- 4.2 negotiating → ask details → escalate on turn 2 -----
  section("4.2 'יקר' → ask details → escalate on turn 2");
  await seedAtFinal();
  await handleDecisionInbound({ sid: TEST_SID, text: "יקר", hasMedia: false });
  r = await readLead();
  assert(
    r.qState?.finalState === "awaiting_haggle_detail",
    "finalState=awaiting_haggle_detail"
  );
  assert(r.pipelineStage === "AWAITING_FINAL", "stage still AWAITING_FINAL");

  await handleDecisionInbound({
    sid: TEST_SID,
    text: "אני יכול 700",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.pipelineFlag === "NEEDS_ELI", "haggle reply → escalate");
  assert(r.botPaused === true, "bot paused after escalate");

  // ----- 4.3 custom_size → escalate (loopback deferred) -----
  section("4.3 spec change → escalate (loopback deferred)");
  await seedAtFinal();
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "אני רוצה דווקא 7000 במקום 5000",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.pipelineFlag === "NEEDS_ELI", "custom_size → escalate");

  // ----- 4.4 payment Q → canned, stay -----
  section("4.4 'איך משלמים?' → canned, stay in AWAITING_FINAL");
  await seedAtFinal();
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "איך תהליך התשלום?",
    hasMedia: false,
  });
  r = await readLead();
  assert(
    r.pipelineStage === "AWAITING_FINAL",
    "payment Q keeps lead in AWAITING_FINAL"
  );
  assert(r.pipelineFlag !== "NEEDS_ELI", "payment Q does NOT escalate");

  // ----- 4.5 silence path — no inbound = no_op; cron handles cadence -----
  section("4.5 cadence-only path validated separately in test-cadence.ts");

  await finishAndExit("test-stage4");
}

main().catch((e) => {
  console.error("test-stage4 crashed:", e);
  process.exit(1);
});

/**
 * Stage 1 (questionnaire) smoke test. Run with:
 *   $env:BRIDGE_DRY_RUN = "1"; npx tsx scripts/test-stage1.ts
 *
 * Covers:
 *   1.5 happy path  — answer all 5 questions, hit calc, end in AWAITING_DECISION
 *   1.1/1.2 re-ask  — 3 unmatched answers now needed to escalate (was: 2)
 *   1.4 factory    — picking "אחר" on quantity routes to WAITING_FACTORY
 *
 * Note: the happy path calls the real bag-quote-app calc API. The other
 * branches don't hit network. If calc is down, the happy path falls through
 * to WAITING_FACTORY (calc-fail fallback) — assertion notes that case.
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
  wipeTestLead,
} from "./test-helpers";
import { handleInbound } from "../lib/autoresponder/questionnaire";

async function main(): Promise<void> {
  ensureDryRun();

  // ----- 1.5 happy path -----
  section("1.5 happy path → AWAITING_DECISION");
  await seedLead({ stage: null, qState: null });

  await handleInbound({ sid: TEST_SID, text: null }); // cold start
  let r = await readLead();
  assert(r.qState?.step === 3, "cold start sets step=3 (shipping)");

  await handleInbound({ sid: TEST_SID, text: "1" }); // shipping=s1
  r = await readLead();
  assert(r.qState?.step === 4 && r.qState?.shipping === "s1", "Q1 → step=4, shipping=s1");

  await handleInbound({ sid: TEST_SID, text: "1" }); // quantity=q0
  r = await readLead();
  assert(r.qState?.step === 5 && r.qState?.quantity === "q0", "Q2 → step=5, quantity=q0");

  await handleInbound({ sid: TEST_SID, text: "1" }); // product=p1
  r = await readLead();
  assert(r.qState?.step === 6 && r.qState?.product === "p1", "Q3 → step=6, product=p1");

  await handleInbound({ sid: TEST_SID, text: "1" }); // handles=true
  r = await readLead();
  assert(r.qState?.step === 7 && r.qState?.handles === "true", "Q4 → step=7, handles=true");

  await handleInbound({ sid: TEST_SID, text: "1" }); // colors=1 → calc
  r = await readLead();
  const inDecision = r.pipelineStage === "AWAITING_DECISION";
  const fellToFactory =
    r.pipelineStage === "WAITING_FACTORY" && r.qState?.bailed === true;
  assert(
    inDecision || fellToFactory,
    inDecision
      ? "Q5 → calc OK → AWAITING_DECISION"
      : "Q5 → calc fail fallback → WAITING_FACTORY (acceptable if calc is down)"
  );

  // ----- 1.1/1.2 re-ask threshold (3 unmatched → escalate) -----
  section("1.1/1.2 reask off-by-one (escalate at 3 unmatched, not 2)");
  await wipeTestLead();
  await seedLead({ stage: null, qState: null });
  await handleInbound({ sid: TEST_SID, text: null }); // cold start

  await handleInbound({ sid: TEST_SID, text: "blabla שטויות" }); // unmatched 1
  r = await readLead();
  assert(r.qState?.unmatchedAt === 1 && !r.qState?.bailed, "after 1 unmatched: counter=1, not bailed");

  await handleInbound({ sid: TEST_SID, text: "עוד שטויות" }); // unmatched 2
  r = await readLead();
  assert(
    r.qState?.unmatchedAt === 2 && !r.qState?.bailed,
    "after 2 unmatched: counter=2, STILL not bailed (was bailed before fix)"
  );

  await handleInbound({ sid: TEST_SID, text: "מה זה" }); // unmatched 3 → escalate
  r = await readLead();
  assert(r.qState?.bailed === true, "after 3 unmatched: bailed=true");
  assert(r.pipelineFlag === "NEEDS_ELI", "after 3 unmatched: NEEDS_ELI flag set");

  // ----- 1.4 custom branch routes to factory -----
  section("1.4 'אחר' on quantity → WAITING_FACTORY");
  await wipeTestLead();
  await seedLead({ stage: null, qState: null });
  await handleInbound({ sid: TEST_SID, text: null });
  await handleInbound({ sid: TEST_SID, text: "1" }); // shipping
  await handleInbound({ sid: TEST_SID, text: "5" }); // quantity = custom
  r = await readLead();
  assert(
    r.qState?.pendingCustomField === "quantity",
    "picking 'אחר' on Q2 sets pendingCustomField=quantity"
  );

  await handleInbound({ sid: TEST_SID, text: "7500" }); // captured
  r = await readLead();
  assert(
    r.qState?.quantityCustom === "7500" && r.qState?.step === 5,
    "custom captured, advance to step=5"
  );

  // Finish remaining Qs with standard options.
  await handleInbound({ sid: TEST_SID, text: "1" }); // product=p1
  await handleInbound({ sid: TEST_SID, text: "1" }); // handles=true
  await handleInbound({ sid: TEST_SID, text: "1" }); // colors=1 → factory
  r = await readLead();
  assert(
    r.pipelineStage === "WAITING_FACTORY",
    "completing questionnaire w/ custom quantity → WAITING_FACTORY"
  );
  assert(r.pipelineFlag === "NEEDS_ELI", "WAITING_FACTORY also sets NEEDS_ELI");

  await finishAndExit("test-stage1");
}

main().catch((e) => {
  console.error("test-stage1 crashed:", e);
  process.exit(1);
});

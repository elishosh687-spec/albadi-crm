/**
 * Stage 2 (post-quote LLM classifier + sub-flows) smoke test.
 *   $env:BRIDGE_DRY_RUN = "1"; npx tsx scripts/test-stage2.ts
 *
 * Requires OPENAI_API_KEY in .env (real classifier calls). Each LLM call
 * costs ~$0.0001 — total run ≈ $0.001.
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

async function seedAtDecision(extra: Record<string, unknown> = {}): Promise<void> {
  await seedLead({
    stage: "AWAITING_DECISION",
    qState: { step: 9, doneAt: new Date().toISOString(), ...extra },
    botPaused: false,
    pipelineFlag: null,
  });
}

async function main(): Promise<void> {
  ensureDryRun();

  // ----- 2.1 accept → AWAITING_LOGO -----
  section("2.1 accept → AWAITING_LOGO");
  await seedAtDecision();
  await handleDecisionInbound({ sid: TEST_SID, text: "מתאים", hasMedia: false });
  let r = await readLead();
  assert(r.pipelineStage === "AWAITING_LOGO", "accept → AWAITING_LOGO");
  assert(r.followUpCount === 0, "accept resets followUpCount");

  // ----- 2.3 negotiating → ask competitor offer -----
  section("2.3 negotiating ('יקר') → awaiting_competitor_offer");
  await seedAtDecision();
  await handleDecisionInbound({ sid: TEST_SID, text: "יקר מדי בשבילי", hasMedia: false });
  r = await readLead();
  assert(
    r.qState?.decisionState === "awaiting_competitor_offer",
    "decisionState set to awaiting_competitor_offer"
  );
  assert(r.pipelineStage === "AWAITING_DECISION", "stage stays AWAITING_DECISION");

  // Turn 2 — customer gives a competitor price → escalate
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "כן יש לי הצעה של 300 שח",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.pipelineFlag === "NEEDS_ELI", "competitor offer w/ price → NEEDS_ELI");
  assert(r.botPaused === true, "bot paused after escalate");

  // ----- 2.2 reject → ask reason; non-price reason → escalate -----
  section("2.2 reject → awaiting_reason; non-price reason → escalate");
  await seedAtDecision();
  await handleDecisionInbound({ sid: TEST_SID, text: "לא תודה", hasMedia: false });
  r = await readLead();
  assert(
    r.qState?.decisionState === "awaiting_reason",
    "reject → decisionState=awaiting_reason"
  );

  await handleDecisionInbound({
    sid: TEST_SID,
    text: "פשוט לא מעוניין כרגע",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.pipelineFlag === "NEEDS_ELI", "non-price reason → escalate");

  // ----- 2.2 reject → 'יקר' → competitor sub-flow -----
  section("2.2→2.3 reject then 'יקר' → competitor sub-flow");
  await seedAtDecision();
  await handleDecisionInbound({ sid: TEST_SID, text: "לא", hasMedia: false });
  r = await readLead();
  assert(r.qState?.decisionState === "awaiting_reason", "still awaiting_reason");

  await handleDecisionInbound({ sid: TEST_SID, text: "כי יקר", hasMedia: false });
  r = await readLead();
  assert(
    r.qState?.decisionState === "awaiting_competitor_offer",
    "reason=יקר → awaiting_competitor_offer"
  );

  // Turn 3 — "לא" to competitor → awaiting_pause_reason
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "אין לי הצעה אחרת",
    hasMedia: false,
  });
  r = await readLead();
  // "אין לי הצעה אחרת" likely classifies as reject → awaiting_pause_reason.
  // If LLM classifies otherwise → may escalate (acceptable variance).
  const movedToPause = r.qState?.decisionState === "awaiting_pause_reason";
  const escalated = r.pipelineFlag === "NEEDS_ELI";
  assert(
    movedToPause || escalated,
    movedToPause
      ? "no-competitor reply → awaiting_pause_reason"
      : "no-competitor reply → escalate (LLM classified ambiguously)"
  );

  // ----- 2.4 canned answers -----
  section("2.4 canned answers (delivery / payment / inclusive)");

  await seedAtDecision();
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "כמה זמן ייקח עד שאקבל?",
    hasMedia: false,
  });
  r = await readLead();
  assert(
    r.pipelineStage === "AWAITING_DECISION",
    "delivery question keeps lead in AWAITING_DECISION"
  );
  assert(r.pipelineFlag !== "NEEDS_ELI", "delivery question does NOT escalate");

  // Stage 2 payment question — per BOT-COPY.md §R9, this is premature at
  // preliminary-quote stage. Bot acks ("זה בטלפון") then escalates so Eli
  // closes by phone. The 50/50 canned reply lives only at Stage 4.
  await seedAtDecision();
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "איך משלמים? צריך מקדמה?",
    hasMedia: false,
  });
  r = await readLead();
  assert(
    r.pipelineFlag === "NEEDS_ELI",
    "payment question at Stage 2 → escalate (premature)"
  );

  await seedAtDecision();
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "המחיר כולל הכל? גם משלוח?",
    hasMedia: false,
  });
  r = await readLead();
  assert(
    r.pipelineStage === "AWAITING_DECISION" && r.pipelineFlag !== "NEEDS_ELI",
    "inclusive question → canned, no escalate"
  );

  // ----- 2.4 question_meeting → escalate -----
  section("2.4 'אפשר בן-אדם?' → escalate");
  await seedAtDecision();
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "אפשר לדבר עם מישהו בטלפון?",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.pipelineFlag === "NEEDS_ELI", "meeting/call request → escalate");

  // ----- 2.5 custom_size → ask for details (sub-state) → escalate on turn 2 -----
  section("2.5 spec change → awaiting_spec_change sub-state → escalate");
  await seedAtDecision();
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "אני רוצה דווקא 8500 יחידות במידה 25x10x35",
    hasMedia: false,
  });
  r = await readLead();
  assert(
    r.qState?.decisionState === "awaiting_spec_change",
    "custom_size sets decisionState=awaiting_spec_change"
  );
  assert(r.pipelineStage === "AWAITING_DECISION", "stage stays AWAITING_DECISION on first turn");

  await handleDecisionInbound({
    sid: TEST_SID,
    text: "כן, 8500 יחידות בגודל 25x10x35",
    hasMedia: false,
  });
  r = await readLead();
  assert(r.pipelineFlag === "NEEDS_ELI", "spec details on turn 2 → escalate");

  // ----- samples → catalog link, no escalate -----
  section("samples_request → catalog link, stay");
  await seedAtDecision();
  await handleDecisionInbound({
    sid: TEST_SID,
    text: "יש לכם קטלוג עם תמונות?",
    hasMedia: false,
  });
  r = await readLead();
  assert(
    r.pipelineStage === "AWAITING_DECISION" && r.pipelineFlag !== "NEEDS_ELI",
    "catalog → stay in AWAITING_DECISION"
  );

  await finishAndExit("test-stage2");
}

main().catch((e) => {
  console.error("test-stage2 crashed:", e);
  process.exit(1);
});

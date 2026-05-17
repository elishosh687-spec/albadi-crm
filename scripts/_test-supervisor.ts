/**
 * Smoke test for the Bot Supervisor Phase 1 pipeline.
 *
 * Steps:
 *   1. Verify bot_decision_log table exists + queryable.
 *   2. logDecision() writes a row and returns its id.
 *   3. attachEliFeedback() updates the most recent row's eli_* columns.
 *   4. attachEliFeedback() outside the 24h window is a no-op (returns null).
 *   5. Reads via loadBotDecisionsAction-equivalent SQL.
 *
 * Does NOT call the supervisor LLM or the bridge — those are exercised by
 * pointing a test JID at the deployed webhook (see docs/binary-chasing-dawn.md
 * §Verification).
 */
import { db } from "../lib/db";
import { botDecisionLog } from "../drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
import { logDecision, attachEliFeedback } from "../lib/supervisor/log";

const TEST_SID = `_test_supervisor_${Date.now()}`;

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`• ${label} ... `);
  try {
    await fn();
    process.stdout.write("OK\n");
  } catch (e) {
    process.stdout.write("FAIL\n");
    console.error(e);
    process.exit(1);
  }
}

async function main() {
  console.log(`\n=== supervisor smoke test (sid=${TEST_SID}) ===\n`);

  await step("table reachable", async () => {
    await db.execute(sql`SELECT COUNT(*) FROM bot_decision_log`);
  });

  let firstId: number | null = null;
  await step("logDecision writes row 1", async () => {
    firstId = await logDecision({
      manychatSubId: TEST_SID,
      inboundText: "טסט: אקבל",
      stageBefore: "AWAITING_ESTIMATE",
      stageAfter: "AWAITING_LOGO",
      llmIntent: "accept",
      llmConfidence: 0.95,
      llmRecommended: "approve_code",
      llmReason: "smoke test: clear accept",
      llmRiskFlags: [],
      decidedBy: "code",
      action: "stage_transition",
      replyText: "מעולה! 🎉 שלח לי בבקשה את הלוגו",
      metadata: { test: true, candidate: "canned_reply" },
    });
    if (!firstId) throw new Error("logDecision returned null id");
  });

  // Sleep 50ms to ensure timestamps differ.
  await new Promise((r) => setTimeout(r, 50));

  let secondId: number | null = null;
  await step("logDecision writes row 2 (escalation)", async () => {
    secondId = await logDecision({
      manychatSubId: TEST_SID,
      inboundText: "טסט: יש לי הצעה ב-1800",
      stageBefore: "AWAITING_ESTIMATE",
      llmIntent: "negotiating_with_competitor",
      llmConfidence: 0.92,
      llmRecommended: "escalate_to_eli",
      llmReason: "smoke test: competitor offer with price",
      llmRiskFlags: ["mentions_competitor_price", "money_moment"],
      decidedBy: "code",
      action: "draft_queued",
      draftId: 9999,
      escalationKind: "supervisor_decision",
      metadata: { test: true },
    });
    if (!secondId) throw new Error("logDecision returned null id");
  });

  await step("attachEliFeedback updates the most recent row (#2)", async () => {
    const updated = await attachEliFeedback({
      manychatSubId: TEST_SID,
      eliAction: "edited_draft",
      eliEditText: "שלח לי בבקשה צילום מההצעה ואני בודק",
    });
    if (updated !== secondId)
      throw new Error(`expected to update row ${secondId}, got ${updated}`);
  });

  await step("eli_* columns reflect the feedback on row 2", async () => {
    const [row] = await db
      .select()
      .from(botDecisionLog)
      .where(eq(botDecisionLog.id, secondId!));
    if (row.eliAction !== "edited_draft")
      throw new Error(`expected eli_action='edited_draft', got ${row.eliAction}`);
    if (!row.eliEditText || !row.eliEditText.includes("שלח לי בבקשה"))
      throw new Error(`expected eli_edit_text to contain the edit text`);
    if (!row.eliDecidedAt)
      throw new Error(`expected eli_decided_at to be set`);
  });

  await step("row 1 still has null eli_action (not touched)", async () => {
    const [row] = await db
      .select()
      .from(botDecisionLog)
      .where(eq(botDecisionLog.id, firstId!));
    if (row.eliAction !== null)
      throw new Error(`expected row 1 untouched, got eli_action=${row.eliAction}`);
  });

  await step("second attachEliFeedback only finds row 1 now", async () => {
    const updated = await attachEliFeedback({
      manychatSubId: TEST_SID,
      eliAction: "approved_as_is",
    });
    if (updated !== firstId)
      throw new Error(`expected to update row 1 (id=${firstId}), got ${updated}`);
  });

  await step("attachEliFeedback no-op when no eligible row", async () => {
    const r = await attachEliFeedback({
      manychatSubId: TEST_SID,
      eliAction: "manual_reply",
      eliManualReply: "third — should not land",
    });
    if (r !== null)
      throw new Error(`expected null (no eligible row), got ${r}`);
  });

  await step("list query returns rows newest first", async () => {
    const rows = await db
      .select()
      .from(botDecisionLog)
      .where(sql`trim(${botDecisionLog.manychatSubId}) = ${TEST_SID}`)
      .orderBy(desc(botDecisionLog.createdAt));
    if (rows.length !== 2)
      throw new Error(`expected 2 rows, got ${rows.length}`);
    if (rows[0].id !== secondId)
      throw new Error(`expected newest first, got ${rows[0].id}`);
  });

  await step("cleanup test rows", async () => {
    await db
      .delete(botDecisionLog)
      .where(sql`trim(${botDecisionLog.manychatSubId}) = ${TEST_SID}`);
  });

  console.log("\n=== ALL SMOKE TESTS PASSED ===\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

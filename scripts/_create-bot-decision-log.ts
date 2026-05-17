/**
 * One-shot: create bot_decision_log table + indices.
 * Idempotent — uses IF NOT EXISTS.
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bot_decision_log (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      manychat_sub_id TEXT NOT NULL,
      message_id INTEGER,
      inbound_text TEXT,
      stage_before TEXT,
      stage_after TEXT,

      langfuse_trace_id TEXT,

      llm_intent TEXT,
      llm_confidence DOUBLE PRECISION,
      llm_recommended TEXT,
      llm_reason TEXT,
      llm_risk_flags JSONB,

      decided_by TEXT NOT NULL,
      action TEXT NOT NULL,
      reply_text TEXT,
      escalation_kind TEXT,
      draft_id INTEGER,
      metadata JSONB,

      eli_action TEXT,
      eli_edit_text TEXT,
      eli_reject_reason TEXT,
      eli_manual_reply TEXT,
      eli_stage_from TEXT,
      eli_stage_to TEXT,
      eli_decided_at TIMESTAMPTZ
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bot_decision_log_sid_created_idx
      ON bot_decision_log (manychat_sub_id, created_at DESC);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bot_decision_log_divergence_idx
      ON bot_decision_log (llm_recommended, decided_by);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bot_decision_log_eli_action_idx
      ON bot_decision_log (eli_action) WHERE eli_action IS NOT NULL;
  `);

  console.log("bot_decision_log + indices created");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

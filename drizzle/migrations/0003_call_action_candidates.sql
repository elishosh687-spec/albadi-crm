CREATE TABLE IF NOT EXISTS "call_action_candidates" (
  "id" serial PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "source_record_id" text NOT NULL,
  "lead_sid" text,
  "ghl_contact_id" text,
  "analysis_version" text NOT NULL,
  "input_hash" text NOT NULL,
  "proposal" jsonb NOT NULL,
  "original_proposal" jsonb NOT NULL,
  "edited_proposal" jsonb,
  "policy_decision" text NOT NULL,
  "decision_reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by" text,
  "human_decision_reason" text,
  "decided_at" timestamp with time zone,
  "ghl_task_id" text,
  "execution_status" text DEFAULT 'not_requested' NOT NULL,
  "idempotency_key" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "call_action_candidates_idempotency_uidx"
  ON "call_action_candidates" USING btree ("idempotency_key");
CREATE INDEX IF NOT EXISTS "call_action_candidates_status_created_idx"
  ON "call_action_candidates" USING btree ("status", "created_at");
CREATE INDEX IF NOT EXISTS "call_action_candidates_lead_status_idx"
  ON "call_action_candidates" USING btree ("lead_sid", "status");
CREATE INDEX IF NOT EXISTS "call_action_candidates_source_record_idx"
  ON "call_action_candidates" USING btree ("source", "source_record_id");

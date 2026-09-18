-- Meta ad recommendations — policy revisions + per-Ad-ID approved review state.
-- Recommendation-only feature: nothing here is read by any code that writes to
-- Meta. See docs/plans/2026-09-18-meta-ad-recommendations-implementation.md.
-- Idempotent (IF NOT EXISTS) so a test branch can apply it before production.

CREATE TABLE IF NOT EXISTS "ad_recommendation_policy_revisions" (
  "revision" integer PRIMARY KEY NOT NULL,
  "settings" jsonb NOT NULL,
  "previous" jsonb,
  "changed_keys" text[] NOT NULL,
  "actor" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_review_state" (
  "ad_id" text PRIMARY KEY NOT NULL,
  "ad_set_id" text,
  "segment" text,
  "role" text,
  "approved_status" text DEFAULT 'untested' NOT NULL,
  "decision_reason" text,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ad_review_state_segment_chk" CHECK ("segment" IS NULL OR "segment" IN ('prospecting','remarketing')),
  CONSTRAINT "ad_review_state_role_chk" CHECK ("role" IS NULL OR "role" IN ('control','challenger','remarketing')),
  CONSTRAINT "ad_review_state_status_chk" CHECK ("approved_status" IN ('untested','testing','winner','loser')),
  CONSTRAINT "ad_review_state_ad_id_chk" CHECK ("ad_id" ~ '^[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_review_state_audit" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "ad_id" text NOT NULL,
  "field" text NOT NULL,
  "old_value" text,
  "new_value" text,
  "reason" text,
  "actor" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_review_state_audit_ad_idx"
  ON "ad_review_state_audit" USING btree ("ad_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "crm_contacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "phone_e164" text UNIQUE,
  "full_name" text,
  "business_name" text,
  "email" text,
  "locale" text DEFAULT 'he-IL',
  "timezone" text DEFAULT 'Asia/Jerusalem',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "crm_lead_episodes" (
  "id" serial PRIMARY KEY NOT NULL,
  "manychat_sub_id" text NOT NULL,
  "contact_id" integer,
  "lifecycle_stage" text DEFAULT 'NEW_INQUIRY' NOT NULL,
  "operational_status" text DEFAULT 'NEW' NOT NULL,
  "owner_id" text,
  "queue_id" text,
  "priority_band" text DEFAULT 'LOW' NOT NULL,
  "score_total" integer DEFAULT 0 NOT NULL,
  "first_contact_at" timestamp with time zone,
  "last_activity_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "crm_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "manychat_sub_id" text NOT NULL,
  "task_type" text DEFAULT 'follow_up' NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "assigned_to" text,
  "due_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "crm_tasks_sid_status_idx"
  ON "crm_tasks" ("manychat_sub_id", "status");

CREATE TABLE IF NOT EXISTS "crm_sla_timers" (
  "id" serial PRIMARY KEY NOT NULL,
  "manychat_sub_id" text NOT NULL,
  "sla_type" text NOT NULL,
  "starts_at" timestamp with time zone DEFAULT now() NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "breached_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "crm_sla_timers_sid_due_idx"
  ON "crm_sla_timers" ("manychat_sub_id", "due_at");

CREATE TABLE IF NOT EXISTS "lead_score_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "manychat_sub_id" text NOT NULL,
  "fit_score" integer DEFAULT 0 NOT NULL,
  "intent_score" integer DEFAULT 0 NOT NULL,
  "engagement_score" integer DEFAULT 0 NOT NULL,
  "friction_penalty" integer DEFAULT 0 NOT NULL,
  "score_total" integer NOT NULL,
  "score_band" text NOT NULL,
  "score_version" text DEFAULT 'v1' NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "lead_score_snapshots_sid_created_idx"
  ON "lead_score_snapshots" ("manychat_sub_id", "created_at");

CREATE TABLE IF NOT EXISTS "source_touches" (
  "id" serial PRIMARY KEY NOT NULL,
  "manychat_sub_id" text NOT NULL,
  "source_primary" text NOT NULL,
  "source_detail_1" text,
  "source_detail_2" text,
  "record_source" text,
  "touch_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "source_touches_sid_touch_idx"
  ON "source_touches" ("manychat_sub_id", "touch_at");

CREATE TABLE IF NOT EXISTS "opportunities" (
  "id" serial PRIMARY KEY NOT NULL,
  "manychat_sub_id" text NOT NULL,
  "pipeline_stage" text DEFAULT 'open' NOT NULL,
  "value_ils" double precision,
  "currency" text DEFAULT 'ILS',
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "won_at" timestamp with time zone,
  "lost_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "consent_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "contact_id" integer,
  "manychat_sub_id" text,
  "consent_type" text NOT NULL,
  "status" text NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);

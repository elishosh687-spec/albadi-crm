CREATE TABLE "anomalies" (
	"id" serial PRIMARY KEY NOT NULL,
	"manychat_sub_id" text NOT NULL,
	"type" text,
	"description" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bot_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"leads_seen" integer DEFAULT 0,
	"decisions" integer DEFAULT 0,
	"replies_sent" integer DEFAULT 0,
	"escalations" integer DEFAULT 0,
	"errors" integer DEFAULT 0,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer,
	"manychat_sub_id" text NOT NULL,
	"lead_name" text,
	"input_messages" jsonb,
	"rule_matched" text,
	"ai_used" boolean,
	"ai_confidence" numeric,
	"classified_tag" text,
	"prev_tag" text,
	"action_taken" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" integer,
	"manychat_sub_id" text NOT NULL,
	"lead_name" text,
	"reason" text NOT NULL,
	"trigger_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "replies_sent" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" integer,
	"manychat_sub_id" text NOT NULL,
	"template_used" text,
	"text" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"manychat_msg_id" text
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_run_id_bot_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bot_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies_sent" ADD CONSTRAINT "replies_sent_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;
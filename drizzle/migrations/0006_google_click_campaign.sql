-- Which Google campaign / ad group / keyword a website lead's click came from
-- (phase 2 of docs/plans/2026-09-23-google-ads-tab-design.md). Filled by the
-- daily google-attribution job. Additive, nullable columns only. Idempotent.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_campaign_id" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_campaign_name" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_ad_group_id" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_ad_group_name" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_keyword" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_match_type" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_click_date" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_attribution" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_attributed_at" timestamp with time zone;

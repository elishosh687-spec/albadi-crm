-- Google Ads click + UTM on website leads (phase 1 of
-- docs/plans/2026-09-23-google-ads-tab-design.md). Additive, nullable columns
-- only: nothing existing changes. Idempotent (IF NOT EXISTS) so a test branch
-- can apply it before production.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_gclid" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_gbraid" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_wbraid" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_source" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_medium" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_campaign" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_term" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "utm_content" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "landing_url" text;

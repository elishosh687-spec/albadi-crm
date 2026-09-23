-- CRM → Google offline conversions (plan phase 5, 2026-09-23): which events
-- a lead already reported to Google Ads, and the last upload error. Additive,
-- nullable columns only. Idempotent.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_qualified_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_quote_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_purchase_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_conversion_error" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "google_conversion_error_at" timestamp with time zone;

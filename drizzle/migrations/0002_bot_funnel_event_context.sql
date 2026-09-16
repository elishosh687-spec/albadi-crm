ALTER TABLE "bot_funnel_events"
  ADD COLUMN IF NOT EXISTS "source" text,
  ADD COLUMN IF NOT EXISTS "value" jsonb;

UPDATE "bot_funnel_events" AS event
SET
  "source" = COALESCE(event."source", lead."lead_source", lead."source", 'unknown'),
  "value" = COALESCE(event."value", event."metadata"->'value')
FROM "leads" AS lead
WHERE trim(lead."manychat_sub_id") = trim(event."lead_sid");

UPDATE "bot_funnel_events"
SET "source" = 'unknown'
WHERE "source" IS NULL;

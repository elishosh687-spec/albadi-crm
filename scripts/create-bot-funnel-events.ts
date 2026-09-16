/**
 * Idempotently creates and backfills the durable WhatsApp bot funnel.
 * Run with DATABASE_URL set to the target Neon branch.
 */
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = neon(databaseUrl);

async function main(): Promise<void> {
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_quality text`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_funnel_events (
      id bigserial PRIMARY KEY,
      lead_sid text NOT NULL,
      attempt_id text,
      event text NOT NULL,
      event_key text,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      bot_version text,
      ad_id text,
      ad_name text,
      campaign_id text,
      campaign_name text,
      quote_id text,
      metadata jsonb
    )
  `;
  await sql`ALTER TABLE bot_funnel_events ADD COLUMN IF NOT EXISTS attempt_id text`;
  await sql`ALTER TABLE bot_funnel_events ADD COLUMN IF NOT EXISTS event_key text`;
  await sql`ALTER TABLE bot_funnel_events ADD COLUMN IF NOT EXISTS bot_version text`;
  await sql`ALTER TABLE bot_funnel_events ADD COLUMN IF NOT EXISTS ad_id text`;
  await sql`ALTER TABLE bot_funnel_events ADD COLUMN IF NOT EXISTS ad_name text`;
  await sql`ALTER TABLE bot_funnel_events ADD COLUMN IF NOT EXISTS campaign_id text`;
  await sql`ALTER TABLE bot_funnel_events ADD COLUMN IF NOT EXISTS campaign_name text`;
  await sql`ALTER TABLE bot_funnel_events ADD COLUMN IF NOT EXISTS quote_id text`;
  await sql`ALTER TABLE bot_funnel_events DROP CONSTRAINT IF EXISTS bot_funnel_events_event_check`;
  await sql`DROP INDEX IF EXISTS bot_funnel_events_lead_event_uidx`;
  await sql`UPDATE bot_funnel_events SET event = 'spec_confirmed' WHERE event = 'questionnaire_completed'`;
  await sql`UPDATE bot_funnel_events SET attempt_id = 'legacy:' || trim(lead_sid) WHERE attempt_id IS NULL`;
  await sql`UPDATE bot_funnel_events SET event_key = attempt_id || ':' || event WHERE event_key IS NULL`;
  await sql`ALTER TABLE bot_funnel_events ALTER COLUMN attempt_id SET NOT NULL`;
  await sql`ALTER TABLE bot_funnel_events ALTER COLUMN event_key SET NOT NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS bot_funnel_events_event_key_uidx ON bot_funnel_events (event_key)`;
  await sql`CREATE INDEX IF NOT EXISTS bot_funnel_events_attempt_event_idx ON bot_funnel_events (attempt_id, event)`;
  await sql`CREATE INDEX IF NOT EXISTS bot_funnel_events_event_occurred_at_idx ON bot_funnel_events (event, occurred_at)`;
  await sql`
    UPDATE bot_funnel_events e SET
      bot_version = coalesce(e.bot_version, 'historical'),
      ad_id = coalesce(e.ad_id, l.meta_ad_id),
      ad_name = coalesce(e.ad_name, l.meta_ad_name),
      campaign_id = coalesce(e.campaign_id, l.meta_campaign_id),
      campaign_name = coalesce(e.campaign_name, l.meta_campaign_name)
    FROM leads l WHERE trim(l.manychat_sub_id) = trim(e.lead_sid)
  `;

await sql`
  INSERT INTO bot_funnel_events (lead_sid, attempt_id, event, event_key, occurred_at, metadata)
  SELECT trim(manychat_sub_id), 'legacy:' || trim(manychat_sub_id),
         'questionnaire_started', 'legacy:' || trim(manychat_sub_id) || ':questionnaire_started', created_at,
         '{"source":"historical_backfill"}'::jsonb
  FROM leads
  WHERE q_state IS NOT NULL
  ON CONFLICT (event_key) DO NOTHING
`;

  for (const [event, field] of [
    ["shipping_answered", "shipping"],
    ["quantity_answered", "quantity"],
    ["size_selected", "product"],
    ["colors_answered", "colors"],
  ] as const) {
    await sql`
      INSERT INTO bot_funnel_events
        (lead_sid, attempt_id, event, event_key, occurred_at, bot_version, metadata)
      SELECT trim(manychat_sub_id), 'legacy:' || trim(manychat_sub_id), ${event},
             'legacy:' || trim(manychat_sub_id) || ':' || ${event}, updated_at,
             'historical', jsonb_build_object('source','historical_backfill','value',q_state->>${field})
      FROM leads WHERE q_state->>${field} IS NOT NULL
      ON CONFLICT (event_key) DO NOTHING
    `;
  }

  await sql`
    INSERT INTO bot_funnel_events
      (lead_sid, attempt_id, event, event_key, occurred_at, bot_version, metadata)
    SELECT trim(manychat_sub_id), 'legacy:' || trim(manychat_sub_id), 'call_booked',
           'legacy:' || trim(manychat_sub_id) || ':call_booked', updated_at,
           'historical', '{"source":"historical_backfill"}'::jsonb
    FROM leads WHERE q_state->>'callbackFlow' = 'answered'
    ON CONFLICT (event_key) DO NOTHING
  `;

  await sql`
    INSERT INTO bot_funnel_events
      (lead_sid, attempt_id, event, event_key, occurred_at, bot_version, metadata)
    SELECT trim(l.manychat_sub_id), 'legacy:' || trim(l.manychat_sub_id), 'human_contacted',
           'legacy:' || trim(l.manychat_sub_id) || ':human_contacted', min(m.received_at),
           'historical', '{"source":"historical_backfill"}'::jsonb
    FROM leads l
    JOIN bot_quotes q ON trim(q.lead_sid) = trim(l.manychat_sub_id) AND q.source = 'initial'
    JOIN messages m ON trim(m.manychat_sub_id) = trim(l.manychat_sub_id)
      AND m.sender = 'eli' AND m.received_at > q.sent_at
    GROUP BY trim(l.manychat_sub_id)
    ON CONFLICT (event_key) DO NOTHING
  `;

  await sql`
    INSERT INTO bot_funnel_events
      (lead_sid, attempt_id, event, event_key, occurred_at, bot_version, metadata)
    SELECT trim(l.manychat_sub_id), 'legacy:' || trim(l.manychat_sub_id), 'call_completed',
           'call_completed:ghl:' || c.ghl_message_id, c.call_started_at,
           'historical', jsonb_build_object('source','historical_backfill','durationSec',c.call_duration_sec)
    FROM call_recording_imports c JOIN leads l ON l.ghl_contact_id = c.ghl_contact_id
    WHERE coalesce(c.call_duration_sec,0) >= 30
    ON CONFLICT (event_key) DO NOTHING
  `;

  await sql`
    INSERT INTO bot_funnel_events
      (lead_sid, attempt_id, event, event_key, occurred_at, bot_version, metadata)
    SELECT trim(manychat_sub_id), 'legacy:' || trim(manychat_sub_id), 'qualified',
           'legacy:' || trim(manychat_sub_id) || ':qualified', updated_at,
           'historical', '{"source":"historical_backfill"}'::jsonb
    FROM leads
    WHERE meta_qualified_sent_at IS NOT NULL
       OR pipeline_stage IN ('DISCAVERY','FACTORY_WAIT','CONSIDERATION','WON')
    ON CONFLICT (event_key) DO NOTHING
  `;

  await sql`
    INSERT INTO bot_funnel_events
      (lead_sid, attempt_id, event, event_key, occurred_at, bot_version, metadata)
    SELECT trim(manychat_sub_id), 'legacy:' || trim(manychat_sub_id), 'deal_closed',
           'legacy:' || trim(manychat_sub_id) || ':deal_closed', updated_at,
           'historical', '{"source":"historical_backfill"}'::jsonb
    FROM leads WHERE pipeline_stage = 'WON'
    ON CONFLICT (event_key) DO NOTHING
  `;

  await sql`
    INSERT INTO bot_funnel_events
      (lead_sid, attempt_id, event, event_key, occurred_at, bot_version, metadata)
    SELECT trim(manychat_sub_id), 'legacy:' || trim(manychat_sub_id), 'lost',
           'legacy:' || trim(manychat_sub_id) || ':lost', updated_at,
           'historical', jsonb_build_object('source','historical_backfill','reason',coalesce(loss_reason,'UNRECORDED'))
    FROM leads WHERE pipeline_stage = 'LOST'
    ON CONFLICT (event_key) DO NOTHING
  `;

await sql`
  INSERT INTO bot_funnel_events (lead_sid, attempt_id, event, event_key, occurred_at, metadata)
  SELECT trim(manychat_sub_id), 'legacy:' || trim(manychat_sub_id),
         'spec_confirmed', 'legacy:' || trim(manychat_sub_id) || ':spec_confirmed',
         CASE
           WHEN (q_state->>'doneAt') ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (q_state->>'doneAt')::timestamptz
           ELSE updated_at
         END,
         '{"source":"historical_backfill"}'::jsonb
  FROM leads
  WHERE q_state->>'doneAt' IS NOT NULL
  ON CONFLICT (event_key) DO NOTHING
`;

await sql`
  INSERT INTO bot_funnel_events (lead_sid, attempt_id, event, event_key, occurred_at, quote_id, metadata)
  SELECT trim(lead_sid), 'legacy:' || trim(lead_sid), 'quote_sent',
         'legacy:' || trim(lead_sid) || ':quote_sent', min(sent_at), min(id)::text,
         '{"source":"historical_backfill"}'::jsonb
  FROM bot_quotes
  WHERE source = 'initial'
  GROUP BY trim(lead_sid)
  ON CONFLICT (event_key) DO NOTHING
`;

await sql`
  INSERT INTO bot_funnel_events (lead_sid, attempt_id, event, event_key, occurred_at, quote_id, metadata)
  SELECT fq.sid, 'legacy:' || fq.sid, 'quote_replied',
         'legacy:' || fq.sid || ':quote_replied', min(m.received_at), fq.quote_id,
         '{"source":"historical_backfill"}'::jsonb
  FROM (
    SELECT DISTINCT ON (trim(lead_sid)) trim(lead_sid) sid, sent_at, id::text quote_id
    FROM bot_quotes
    WHERE source = 'initial'
    ORDER BY trim(lead_sid), sent_at
  ) fq
  JOIN messages m
    ON trim(m.manychat_sub_id) = fq.sid
   AND (m.sender = 'lead' OR m.direction = 'in')
   AND m.received_at > fq.sent_at
  GROUP BY fq.sid, fq.quote_id
  ON CONFLICT (event_key) DO NOTHING
`;

await sql`
  UPDATE bot_funnel_events e SET
    bot_version = coalesce(e.bot_version, 'historical'),
    ad_id = coalesce(e.ad_id, l.meta_ad_id),
    ad_name = coalesce(e.ad_name, l.meta_ad_name),
    campaign_id = coalesce(e.campaign_id, l.meta_campaign_id),
    campaign_name = coalesce(e.campaign_name, l.meta_campaign_name)
  FROM leads l WHERE trim(l.manychat_sub_id) = trim(e.lead_sid)
`;

const counts = await sql`
  SELECT event, count(*)::int AS count
  FROM bot_funnel_events
  GROUP BY event
  ORDER BY event
`;
console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

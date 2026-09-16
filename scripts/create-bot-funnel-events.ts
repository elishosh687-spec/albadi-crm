/**
 * Idempotently creates and backfills the durable WhatsApp bot funnel.
 * Run with DATABASE_URL set to the target Neon branch.
 */
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = neon(databaseUrl);

async function main(): Promise<void> {
await sql`
  CREATE TABLE IF NOT EXISTS bot_funnel_events (
    id bigserial PRIMARY KEY,
    lead_sid text NOT NULL,
    event text NOT NULL CHECK (event IN (
      'questionnaire_started',
      'questionnaire_completed',
      'quote_sent',
      'quote_replied'
    )),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb
  )
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS bot_funnel_events_lead_event_uidx ON bot_funnel_events (lead_sid, event)`;
await sql`CREATE INDEX IF NOT EXISTS bot_funnel_events_event_occurred_at_idx ON bot_funnel_events (event, occurred_at)`;

await sql`
  INSERT INTO bot_funnel_events (lead_sid, event, occurred_at, metadata)
  SELECT trim(manychat_sub_id), 'questionnaire_started', created_at,
         '{"source":"historical_backfill"}'::jsonb
  FROM leads
  WHERE q_state IS NOT NULL
  ON CONFLICT (lead_sid, event) DO NOTHING
`;

await sql`
  INSERT INTO bot_funnel_events (lead_sid, event, occurred_at, metadata)
  SELECT trim(manychat_sub_id), 'questionnaire_completed',
         CASE
           WHEN (q_state->>'doneAt') ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (q_state->>'doneAt')::timestamptz
           ELSE updated_at
         END,
         '{"source":"historical_backfill"}'::jsonb
  FROM leads
  WHERE q_state->>'doneAt' IS NOT NULL
  ON CONFLICT (lead_sid, event) DO NOTHING
`;

await sql`
  INSERT INTO bot_funnel_events (lead_sid, event, occurred_at, metadata)
  SELECT trim(lead_sid), 'quote_sent', min(sent_at),
         '{"source":"historical_backfill"}'::jsonb
  FROM bot_quotes
  WHERE source = 'initial'
  GROUP BY trim(lead_sid)
  ON CONFLICT (lead_sid, event) DO NOTHING
`;

await sql`
  INSERT INTO bot_funnel_events (lead_sid, event, occurred_at, metadata)
  SELECT fq.sid, 'quote_replied', min(m.received_at),
         '{"source":"historical_backfill"}'::jsonb
  FROM (
    SELECT trim(lead_sid) sid, min(sent_at) sent_at
    FROM bot_quotes
    WHERE source = 'initial'
    GROUP BY trim(lead_sid)
  ) fq
  JOIN messages m
    ON trim(m.manychat_sub_id) = fq.sid
   AND (m.sender = 'lead' OR m.direction = 'in')
   AND m.received_at > fq.sent_at
  GROUP BY fq.sid
  ON CONFLICT (lead_sid, event) DO NOTHING
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

/**
 * Is the AI layer alive again after the credit top-up?
 *
 * Reads the five jobs that share the one OpenAI account. Each row answers a
 * different question, so a partial recovery is visible rather than averaged
 * away.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const recs = await sql`
    SELECT status, count(*)::int AS n,
           max(created_at) AS newest,
           max(transcribed_at) AS last_transcribed,
           max(analyzed_at) AS last_analyzed
    FROM call_recording_imports
    GROUP BY status ORDER BY n DESC`;
  console.log("\n== call_recording_imports ==");
  console.table(recs);

  const stuck = await sql`
    SELECT id, ghl_message_id, status, attempts,
           left(coalesce(last_error,''), 120) AS err,
           call_started_at, created_at
    FROM call_recording_imports
    WHERE status NOT IN ('posted','skipped_voicemail','skipped_oversize','no_answer')
    ORDER BY created_at DESC LIMIT 15`;
  console.log("\n== recordings still in flight ==");
  console.table(stuck);

  const el = await sql`
    SELECT status, count(*)::int AS n, max(created_at) AS newest
    FROM elevenlabs_call_imports GROUP BY status ORDER BY n DESC`;
  console.log("\n== elevenlabs_call_imports ==");
  console.table(el);

  const an = await sql`
    SELECT date_trunc('day', created_at) AS day, count(*)::int AS n
    FROM lead_analyses
    WHERE created_at > now() - interval '7 days'
    GROUP BY 1 ORDER BY 1 DESC`;
  console.log("\n== lead_analyses per day (7d) ==");
  console.table(an);

  const setter = await sql`
    SELECT date_trunc('hour', created_at) AS hour,
           count(*)::int AS decisions,
           count(*) FILTER (WHERE draft_text IS NOT NULL)::int AS with_text,
           count(*) FILTER (WHERE draft_text IS NULL)::int AS null_text
    FROM setter_decisions
    WHERE created_at > now() - interval '36 hours'
    GROUP BY 1 ORDER BY 1 DESC LIMIT 24`;
  console.log("\n== setter_decisions by hour (36h) — NULL draft_text = LLM dead ==");
  console.table(setter);

  const lastSetter = await sql`
    SELECT created_at, manychat_sub_id, action,
           left(coalesce(draft_text,'<NULL>'), 90) AS draft
    FROM setter_decisions ORDER BY created_at DESC LIMIT 8`;
  console.log("\n== last 8 setter decisions ==");
  console.table(lastSetter);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS elevenlabs_call_imports (
      id serial PRIMARY KEY,
      conversation_id text NOT NULL UNIQUE,
      agent_id text,
      phone text,
      direction text,
      call_duration_sec integer,
      call_started_at timestamptz,
      ghl_contact_id text,
      transcript text,
      enriched_at timestamptz,
      analysis jsonb,
      analyzed_at timestamptz,
      recording_ghl_url text,
      posted_note_id text,
      attached_message_id text,
      posted_back_at timestamptz,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      last_error_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS elevenlabs_call_imports_status_attempts_idx
      ON elevenlabs_call_imports (status, attempts)`);
  const r: any = await db.execute(sql`SELECT count(*)::int AS n FROM elevenlabs_call_imports`);
  console.log("table ready, rows:", (r.rows??r)[0].n);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});

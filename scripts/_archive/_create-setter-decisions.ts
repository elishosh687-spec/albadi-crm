import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS setter_decisions (
      id serial PRIMARY KEY,
      manychat_sub_id text NOT NULL,
      trigger text NOT NULL,
      mode text NOT NULL,
      stage text,
      intent text,
      objection_type text,
      buying_signal text,
      meeting_readiness text,
      goal text,
      skills text,
      draft_text text,
      validation jsonb,
      context jsonb,
      human_feedback text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS setter_decisions_sid_idx ON setter_decisions (manychat_sub_id, created_at)`
  );
  console.log("setter_decisions ready");
}
main().then(() => process.exit(0));

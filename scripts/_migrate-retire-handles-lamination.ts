/**
 * One-time migration: questionnaire retired steps 6 (handles) and 7 (lamination).
 *
 * Effect on in-flight leads:
 *   - step 6 (was about to be asked handles)    → step 8 (colors) + defaults injected
 *   - step 7 (was about to be asked lamination) → step 8 (colors) + defaults injected
 *
 * Defaults match HANDLES_DEFAULT/LAMINATION_DEFAULT in lib/autoresponder/questionnaire.ts.
 * `||` operator is "right wins" — existing keys in q_state are preserved.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const HANDLES_DEFAULT = "true";
const LAMINATION_DEFAULT = "false";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const sql = neon(process.env.DATABASE_URL);
  const dry = !process.argv.includes("--confirm");

  const rows = (await sql`
    SELECT
      manychat_sub_id,
      (q_state->>'step')::int AS step,
      q_state->>'handles'     AS handles,
      q_state->>'lamination'  AS lamination
    FROM leads
    WHERE q_state IS NOT NULL
      AND (q_state->>'step')::int IN (6, 7)
  `) as Array<{ manychat_sub_id: string; step: number; handles: string | null; lamination: string | null }>;

  console.log(`Affected leads: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  sid=${r.manychat_sub_id}  step=${r.step}  handles=${r.handles ?? "—"}  lamination=${r.lamination ?? "—"}`
    );
  }

  if (rows.length === 0) {
    console.log("Nothing to migrate.");
    process.exit(0);
  }

  if (dry) {
    console.log("\n(dry run — pass --confirm to apply)");
    process.exit(0);
  }

  // Merge order: defaults FIRST, then existing q_state (right wins on conflict),
  // then force step=8. Existing handles/lamination preserved; missing filled.
  const updated = (await sql`
    UPDATE leads
    SET q_state =
        (jsonb_build_object('handles', ${HANDLES_DEFAULT}::text, 'lamination', ${LAMINATION_DEFAULT}::text) || q_state)
        || jsonb_build_object('step', 8),
        updated_at = NOW()
    WHERE q_state IS NOT NULL
      AND (q_state->>'step')::int IN (6, 7)
    RETURNING manychat_sub_id
  `) as Array<{ manychat_sub_id: string }>;
  console.log(`\nUpdated ${updated.length} leads.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

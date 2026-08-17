/**
 * Re-queue only the recordings that died of the 17.8 credit exhaustion.
 *
 * Those rows hit attempts=3 and went terminal `failed`, which excludes them
 * from every stage forever — a top-up alone does not bring them back. Rows
 * that failed for a real reason ("returned no text", timeout) are left alone;
 * re-running them would just burn the same money twice.
 *
 * Dry by default. Pass --go to write.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const GO = process.argv.includes("--go");

async function main() {
  const rows = await sql`
    SELECT id, ghl_message_id, attempts, call_started_at
    FROM call_recording_imports
    WHERE status = 'failed'
      AND (last_error ILIKE '%no credits remaining%'
        OR last_error ILIKE '%credit_balance_exhausted%')
    ORDER BY call_started_at`;

  console.log(`${rows.length} recording(s) failed on credit exhaustion:`);
  console.table(rows);
  if (!rows.length) return;

  if (!GO) {
    console.log("\nDRY RUN — pass --go to re-queue these as pending/attempts=0.");
    return;
  }

  const ids = rows.map((r: any) => r.id);
  const upd = await sql`
    UPDATE call_recording_imports
    SET status = 'pending', attempts = 0, last_error = NULL, last_error_at = NULL
    WHERE id = ANY(${ids}::bigint[])
    RETURNING id`;
  console.log(`\nre-queued ${upd.length} row(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

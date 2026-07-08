/**
 * One-time backfill: set the GHL "Last Call Date" custom field on every contact
 * to its most-recent phone call (MAX call_started_at from call_recording_imports).
 * After this, GHL's sortable "Last Call Date" column reflects all historical calls
 * — the ongoing pipeline (process-recordings stampLastCall) keeps it fresh.
 *
 * Run (prod GHL creds resolve from the DB OAuth token):
 *   DATABASE_URL="$(neonctl connection-string ...)" GHL_LOCATION_ID=... \
 *   GHL_FIELD_LAST_CALL_AT=<field-id> npx tsx scripts/backfill-last-call-field.ts [--go]
 *
 * Dry-run by default; pass --go to actually PATCH GHL.
 */
import { db } from "../lib/db";
import { callRecordingImports } from "../drizzle/schema";
import { sql, isNotNull } from "drizzle-orm";
import { updateContact } from "../integrations/ghl/client";
import { GHL_FIELD_IDS } from "../integrations/ghl/config";

async function main() {
  const go = process.argv.includes("--go");
  const fieldId = GHL_FIELD_IDS.last_call_at;
  if (!fieldId) {
    console.error("GHL_FIELD_LAST_CALL_AT not set — create the field + set the env first.");
    process.exit(1);
  }
  const rows = await db
    .select({
      contactId: callRecordingImports.ghlContactId,
      maxAt: sql<string>`max(${callRecordingImports.callStartedAt})`,
    })
    .from(callRecordingImports)
    .where(isNotNull(callRecordingImports.callStartedAt))
    .groupBy(callRecordingImports.ghlContactId);

  const valid = rows.filter((r) => r.contactId && r.maxAt);
  console.log(`${valid.length} contacts with calls${go ? "" : " (dry-run — pass --go to apply)"}`);
  let ok = 0;
  for (const r of valid) {
    const iso = new Date(r.maxAt).toISOString();
    if (!go) {
      console.log(`  ${r.contactId} → ${iso}`);
      continue;
    }
    try {
      await updateContact(r.contactId, { customFields: [{ id: fieldId, value: iso }] });
      ok++;
    } catch (e) {
      console.warn(`  FAILED ${r.contactId}:`, e instanceof Error ? e.message : String(e));
    }
  }
  if (go) console.log(`Done — patched ${ok}/${valid.length}.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

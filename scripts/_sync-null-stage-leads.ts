/**
 * One-shot: find every active lead stuck at NULL pipeline_stage with no
 * ghl_opportunity_id, and force-sync them to GHL. pickStageId maps NULL
 * to INTAKE (decision documented 2026-06-07 in integrations/ghl/mapping.ts)
 * so they appear in the Kanban as soon as the opportunity is created.
 */
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { syncLeadToGHL } from "../integrations/ghl/sync";

async function main() {
  // Limited to Ronen Gilad only — the lead the user flagged. To expand to
  // every NULL-stage lead, switch back to the where-clause version.
  const stuck = await db
    .select({ sid: leads.manychatSubId, name: leads.name, phone: leads.phoneE164, ghlContactId: leads.ghlContactId })
    .from(leads)
    .where(eq(leads.manychatSubId, "972525171818@s.whatsapp.net"));

  console.log(`Found ${stuck.length} target lead(s).\n`);

  for (const l of stuck) {
    console.log(`  ${l.name ?? "(no name)"}  ${l.phone}  sid=${l.sid}`);
    try {
      await syncLeadToGHL(l.sid);
      // Re-fetch to verify
      const after = await db
        .select({ oppId: leads.ghlOpportunityId, ghlContactId: leads.ghlContactId })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${l.sid.trim()}`)
        .limit(1);
      const a = after[0];
      console.log(`     after sync: ghl_contact_id=${a?.ghlContactId}  ghl_opportunity_id=${a?.oppId ?? "still null"}`);
    } catch (err) {
      console.error(`     FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

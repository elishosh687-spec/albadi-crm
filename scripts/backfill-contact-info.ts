/**
 * Backfill leads.name + leads.phone_e164 from the bridge /v1/contacts/<jid>
 * endpoint. Bridge events do not carry contact metadata for @lid JIDs, so
 * leads created from `message.received` start with null name/phone. This
 * script walks every active lead with a non-null wa_jid and fills in the
 * gaps from the bridge.
 *
 * Coalesce semantics — never overwrites an existing value. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-contact-info.ts            # dry run
 *   npx tsx scripts/backfill-contact-info.ts --confirm  # apply
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { isNotNull, sql } from "drizzle-orm";
import {
  fetchBridgeContact,
  nameFromBridgeContact,
  phoneFromBridgePn,
} from "@/lib/bridge/client";

const confirm = process.argv.includes("--confirm");

(async () => {
  const candidates = await db
    .select({
      sid: leads.manychatSubId,
      jid: leads.waJid,
      name: leads.name,
      phone: leads.phoneE164,
    })
    .from(leads)
    .where(
      sql`${leads.waJid} IS NOT NULL AND (${leads.name} IS NULL OR ${leads.phoneE164} IS NULL)`
    );

  console.log(`[backfill-contact] ${candidates.length} leads need enrichment`);

  let fetched = 0;
  let updated = 0;
  let nameAdds = 0;
  let phoneAdds = 0;
  const errors: Array<{ sid: string; err: string }> = [];

  for (const row of candidates) {
    const jid = row.jid!;
    try {
      const contact = await fetchBridgeContact(jid);
      fetched++;
      if (!contact) continue;
      const newName = row.name ?? nameFromBridgeContact(contact);
      const newPhone = row.phone ?? phoneFromBridgePn(contact.pn);
      const willName = !row.name && newName;
      const willPhone = !row.phone && newPhone;
      if (!willName && !willPhone) continue;

      console.log(
        `  ${jid.padEnd(36)}  name=${willName ? `+${newName}` : "(keep)"}  phone=${
          willPhone ? `+${newPhone}` : "(keep)"
        }`
      );
      if (willName) nameAdds++;
      if (willPhone) phoneAdds++;
      updated++;

      if (confirm) {
        await db
          .update(leads)
          .set({
            name: sql`coalesce(${leads.name}, ${newName ?? null})`,
            phoneE164: sql`coalesce(${leads.phoneE164}, ${newPhone ?? null})`,
            updatedAt: new Date(),
          })
          .where(sql`trim(${leads.manychatSubId}) = ${row.sid.trim()}`);
      }
    } catch (e) {
      errors.push({
        sid: row.sid,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.log(`\n[backfill-contact] fetched=${fetched}  updates=${updated}  names+${nameAdds}  phones+${phoneAdds}`);
  if (errors.length) {
    console.log("\nERRORS:");
    for (const e of errors) console.log(`  ${e.sid}  ${e.err}`);
  }
  if (!confirm) {
    console.log("\nRe-run with --confirm to apply.");
  }
  // Reference isNotNull so unused-import lint doesn't flag the helper.
  void isNotNull;
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

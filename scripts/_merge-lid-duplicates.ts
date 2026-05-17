/**
 * One-time cleanup: find all @lid stub leads that duplicate an existing
 * phone-based lead, merge their data into the canonical lead, then delete.
 *
 * Run:  npx tsx scripts/_merge-lid-duplicates.ts
 * Dry:  DRY_RUN=1 npx tsx scripts/_merge-lid-duplicates.ts
 */
import { db } from "../lib/db";
import {
  leads,
  leadTags,
  messages,
  botDrafts,
  factoryQuoteRequests,
} from "../drizzle/schema";
import { eq, like, and, isNotNull, ne } from "drizzle-orm";

const DRY = process.env.DRY_RUN === "1";

async function main() {
  // All leads whose manychat_sub_id ends with @lid (bridge-origin stubs)
  const lidLeads = await db
    .select({
      sid: leads.manychatSubId,
      phone: leads.phoneE164,
      waJid: leads.waJid,
      name: leads.name,
    })
    .from(leads)
    .where(like(leads.manychatSubId, "%@lid"));

  console.log(`Found ${lidLeads.length} @lid leads`);

  let merged = 0;
  let skipped = 0;

  for (const lid of lidLeads) {
    if (!lid.phone) {
      // No phone — can't match. Try by waJid → phone JID
      const phoneJid = lid.waJid ?? lid.sid;
      const phone = phoneJid.split("@")[0];
      if (!phone || phone.length < 9) {
        console.log(`  SKIP ${lid.sid} — no phone, no resolvable JID`);
        skipped++;
        continue;
      }
      // Try to find canonical by phone extracted from JID
      const byPhone = await db
        .select({ sid: leads.manychatSubId, name: leads.name })
        .from(leads)
        .where(and(eq(leads.phoneE164, phone), ne(leads.manychatSubId, lid.sid)))
        .limit(1);
      if (byPhone.length === 0) {
        console.log(`  SKIP ${lid.sid} — no canonical match for phone ${phone}`);
        skipped++;
        continue;
      }
      await doMerge(lid.sid, byPhone[0].sid, lid.sid, byPhone[0].name);
      merged++;
      continue;
    }

    // Find canonical lead with same phone but different sub_id
    const canonical = await db
      .select({ sid: leads.manychatSubId, name: leads.name })
      .from(leads)
      .where(eq(leads.phoneE164, lid.phone))
      .limit(2); // limit 2 so we detect if phone itself is the key

    const others = canonical.filter((r) => r.sid !== lid.sid);
    if (others.length === 0) {
      console.log(`  SKIP ${lid.sid} (${lid.name}) — only lead with phone ${lid.phone}`);
      skipped++;
      continue;
    }

    const target = others[0];
    await doMerge(lid.sid, target.sid, lid.name ?? lid.sid, target.name ?? target.sid);
    merged++;
  }

  console.log(`\nDone. Merged: ${merged}, Skipped: ${skipped}`);
}

async function doMerge(fromSid: string, toSid: string, fromLabel: string, toLabel: string | null) {
  const msgCount = (await db.select({ id: messages.id }).from(messages).where(eq(messages.manychatSubId, fromSid))).length;
  const tagCount = (await db.select({ id: leadTags.id }).from(leadTags).where(eq(leadTags.manychatSubId, fromSid))).length;

  console.log(`  MERGE "${fromLabel}" (${fromSid}) → "${toLabel}" (${toSid})  [msgs:${msgCount} tags:${tagCount}]`);

  if (DRY) return;

  await Promise.all([
    db.update(messages).set({ manychatSubId: toSid }).where(eq(messages.manychatSubId, fromSid)),
    db.update(leadTags).set({ manychatSubId: toSid }).where(eq(leadTags.manychatSubId, fromSid)),
    db.update(botDrafts).set({ manychatSubId: toSid }).where(eq(botDrafts.manychatSubId, fromSid)),
    db.update(factoryQuoteRequests).set({ manychatSubId: toSid }).where(eq(factoryQuoteRequests.manychatSubId, fromSid)),
  ]);

  // Update canonical's wa_jid to the @lid so future messages route correctly
  await db.update(leads).set({ waJid: fromSid, updatedAt: new Date() }).where(eq(leads.manychatSubId, toSid));

  await db.delete(leads).where(eq(leads.manychatSubId, fromSid));
}

main().catch(console.error);

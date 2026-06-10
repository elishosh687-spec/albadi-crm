import { db } from "../lib/db";
import { leads, leadTags, messages } from "../drizzle/schema";
import { eq, sql, desc } from "drizzle-orm";

async function main() {
  const phone = "972525755705";

  // Find all leads with this phone
  const leadRows = await db
    .select()
    .from(leads)
    .where(sql`${leads.phoneE164} = ${phone} OR ${leads.waJid} like ${"%" + phone + "%"} OR ${leads.manychatSubId} like ${"%" + phone + "%"}`);

  console.log(`\n=== Leads matching phone ${phone} ===`);
  console.log(`Found: ${leadRows.length}\n`);
  for (const l of leadRows) {
    console.log(`  sid=${l.manychatSubId}`);
    console.log(`    name=${l.name}  phone=${l.phoneE164}  jid=${l.waJid}`);
    console.log(`    source=${l.source}  leadSource=${l.leadSource}  stage=${l.pipelineStage}`);
    console.log(`    ghl_contact_id=${l.ghlContactId}  ghl_opportunity_id=${l.ghlOpportunityId}`);
    console.log(`    created=${l.createdAt}  updated=${l.updatedAt}`);

    const tagCount = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(leadTags)
      .where(sql`trim(${leadTags.manychatSubId}) = ${l.manychatSubId.trim()}`);
    const msgCount = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(messages)
      .where(sql`trim(${messages.manychatSubId}) = ${l.manychatSubId.trim()}`);
    const lastMsg = await db
      .select({ at: messages.receivedAt, dir: messages.direction })
      .from(messages)
      .where(sql`trim(${messages.manychatSubId}) = ${l.manychatSubId.trim()}`)
      .orderBy(desc(messages.receivedAt))
      .limit(1);

    console.log(`    related: ${tagCount[0].c} tags, ${msgCount[0].c} messages (last: ${lastMsg[0]?.dir ?? "—"} @ ${lastMsg[0]?.at ?? "—"})`);
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

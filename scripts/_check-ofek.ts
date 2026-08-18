import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
async function main() {
  const rows = await db.select({ sid: leads.manychatSubId, name: leads.name, phone: leads.phoneE164, waJid: leads.waJid, stage: leads.pipelineStage, ghl: leads.ghlContactId, src: leads.source, created: leads.createdAt })
    .from(leads)
    .where(sql`${leads.phoneE164} LIKE '%50914783%' OR ${leads.waJid} LIKE '%50914783%' OR ${leads.manychatSubId} LIKE '%50914783%'`);
  console.log("leads matching 50914783:", rows.length);
  for (const r of rows) console.log(JSON.stringify(r));
  // Any messages under that sid?
  const msgs = await db.select({ c: sql<number>`count(*)` }).from(messages).where(sql`${messages.manychatSubId} LIKE '%50914783%'`);
  console.log("messages count:", msgs[0]?.c);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

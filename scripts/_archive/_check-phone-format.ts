import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { sql, isNotNull } from "drizzle-orm";

async function main() {
  const sample = await db
    .select({
      phone: leads.phoneE164,
      jid: leads.waJid,
      sid: leads.manychatSubId,
    })
    .from(leads)
    .where(isNotNull(leads.phoneE164))
    .limit(8);

  console.log("Sample phoneE164 storage format:");
  for (const r of sample) {
    console.log(`  phone="${r.phone}"  jid="${r.jid}"  sid="${r.sid}"`);
  }

  const withPlus = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`${leads.phoneE164} like '+%'`);
  const noPlus = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`${leads.phoneE164} like '9%'`);
  const total = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(isNotNull(leads.phoneE164));

  console.log(`\nTotal with phone: ${total[0].c}`);
  console.log(`  starts with '+' : ${withPlus[0].c}`);
  console.log(`  starts with '9' : ${noPlus[0].c}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

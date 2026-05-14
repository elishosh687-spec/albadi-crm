import "dotenv/config";
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { sql } from "drizzle-orm";

async function main() {
  const sid = process.argv[2];
  const phone = process.argv[3];
  if (!sid || !phone) {
    console.error("usage: tsx scripts/backfill-one-jid.ts <sub_id> <phone_digits>");
    process.exit(1);
  }
  const jid = `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
  const r = await db
    .update(leads)
    .set({ waJid: jid, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .returning({ sub: leads.manychatSubId, jid: leads.waJid });
  console.log("updated rows:", r.length);
  for (const row of r) console.log(" -", JSON.stringify(row));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

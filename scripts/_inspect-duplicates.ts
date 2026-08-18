/**
 * Inspect duplicate leads pairs:
 *   - "G Sushi" / "G SUSHI" (case differs, same updated_at)
 *   - "Ofek Smadar" / "אופק סמדר" (English vs Hebrew, 1 min apart)
 * Run: DATABASE_URL=... npx tsx scripts/_inspect-duplicates.ts
 */
import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { ilike, or, eq, desc, sql } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      waJid: leads.waJid,
      ghlId: leads.ghlContactId,
      source: leads.source,
      leadSource: leads.leadSource,
      stage: leads.pipelineStage,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(
      or(
        ilike(leads.name, "%sushi%"),
        ilike(leads.name, "%ofek%"),
        ilike(leads.name, "%אופק%"),
        ilike(leads.name, "%סמדר%"),
        ilike(leads.name, "%smadar%")
      )!
    );

  for (const r of rows) {
    console.log("---");
    console.log({
      name: r.name,
      sid: r.sid,
      phone: r.phone,
      waJid: r.waJid,
      ghlId: r.ghlId?.slice(0, 14),
      source: r.source,
      leadSource: r.leadSource,
      stage: r.stage,
      createdAt: r.createdAt?.toISOString(),
      updatedAt: r.updatedAt?.toISOString(),
    });
    // first 3 messages per lead (channel hint)
    const msgs = await db.execute(sql`
      SELECT received_at, direction, sender, substr(text, 1, 60) as text
      FROM messages
      WHERE manychat_sub_id = ${r.sid}
      ORDER BY received_at DESC
      LIMIT 3
    `);
    if (msgs.rows?.length) {
      console.log("  recent messages:", msgs.rows);
    } else {
      console.log("  (no messages in DB)");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

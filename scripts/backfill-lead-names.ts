/**
 * Backfill leads.name from ManyChat for rows where name is null/empty.
 * Run: npx tsx scripts/backfill-lead-names.ts
 */
import "dotenv/config";
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { eq, and, isNull, or, sql } from "drizzle-orm";
import { getSubscriber } from "../lib/manychat/client";

async function main() {
  const rows = await db
    .select({ id: leads.manychatSubId, name: leads.name })
    .from(leads)
    .where(
      and(
        eq(leads.active, true),
        or(isNull(leads.name), sql`${leads.name} = ''`)
      )
    );
  console.log(`leads missing name: ${rows.length}`);

  let updated = 0;
  let failed = 0;
  for (const r of rows) {
    const cleanSid = r.id.trim();
    try {
      const sub = await getSubscriber(cleanSid);
      if (sub.name && sub.name.trim()) {
        await db
          .update(leads)
          .set({ name: sub.name, updatedAt: new Date() })
          .where(eq(leads.manychatSubId, r.id));
        updated++;
        console.log(`  OK   ${cleanSid}  ${sub.name}`);
      } else {
        console.log(`  SKIP ${cleanSid}  (ManyChat name is empty)`);
      }
    } catch (e: any) {
      failed++;
      console.log(`  FAIL ${cleanSid}  ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`\nUpdated: ${updated}  Failed: ${failed}  Total: ${rows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * One-shot: remove the auto-managed `bot_active` / `eli_action` tags from
 * every GHL contact + clear the matching lead_tags rows. Run once after
 * the reconciler stopped emitting these tags.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { leads, leadTags } from "../drizzle/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { removeContactTags } from "../integrations/ghl/client";

const OWNER_TAGS = ["bot_active", "eli_action"];

async function main() {
  const rows = await db
    .select({ sid: leads.manychatSubId, ghlContactId: leads.ghlContactId })
    .from(leads)
    .where(sql`${leads.ghlContactId} IS NOT NULL`);

  console.log(`Cleaning owner tags from ${rows.length} GHL contacts...`);

  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    try {
      await removeContactTags(r.ghlContactId!, OWNER_TAGS);
      ok++;
    } catch (e) {
      fail++;
      console.warn(`  ✗ ${r.sid}`, e instanceof Error ? e.message : e);
    }
    await new Promise((res) => setTimeout(res, 600));
  }

  const deleted = await db
    .delete(leadTags)
    .where(inArray(leadTags.tag, OWNER_TAGS))
    .returning({ id: leadTags.id });

  console.log(
    `\nDone. ghl_removed=${ok} ghl_fail=${fail} lead_tags_deleted=${deleted.length}`
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

/**
 * One-shot backfill: walk every lead with `ghl_contact_id IS NOT NULL` and
 * run `reconcileGHLTasksForLead(sid)` so the signal-derived GHL Tasks tab
 * + owner tag are in sync with current DB state.
 *
 * Usage:
 *   npx tsx scripts/reconcile-ghl-tasks-all.ts
 *   npx tsx scripts/reconcile-ghl-tasks-all.ts --limit=50
 *   npx tsx scripts/reconcile-ghl-tasks-all.ts --sid=<single>
 */
import "dotenv/config";
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { sql } from "drizzle-orm";
import { reconcileGHLTasksForLead } from "../lib/ghl-tasks/reconcile";

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0"
  ) || 0;
  const sidArg = args.find((a) => a.startsWith("--sid="))?.split("=")[1];

  const rows = sidArg
    ? await db
        .select({ sid: leads.manychatSubId })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${sidArg.trim()}`)
    : await db
        .select({ sid: leads.manychatSubId })
        .from(leads)
        .where(sql`${leads.ghlContactId} IS NOT NULL`)
        .orderBy(leads.updatedAt)
        .limit(limit > 0 ? limit : 10_000);

  console.log(`Reconciling ${rows.length} leads...`);

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let withTasks = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const sid = rows[i].sid;
    try {
      const r = await reconcileGHLTasksForLead(sid);
      if (r) {
        created += r.created;
        updated += r.updated;
        deleted += r.deleted;
        if (r.ownerTag === "eli_action") withTasks++;
      }
      if ((i + 1) % 10 === 0) {
        console.log(
          `  [${i + 1}/${rows.length}] created=${created} updated=${updated} deleted=${deleted}`
        );
      }
    } catch (e) {
      errors++;
      console.error(`  ✗ ${sid}`, e instanceof Error ? e.message : e);
    }
    await new Promise((res) => setTimeout(res, 120));
  }

  console.log(
    `\nDone. created=${created} updated=${updated} deleted=${deleted} eli_action=${withTasks} errors=${errors}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * One-shot: push every open crm_tasks row that has a matching GHL contact
 * to GHL as a Contact Task. Idempotent — skips rows where `ghl_task_id` is
 * already set. Useful right after first ENABLE_GHL_SYNC=1 + the task sync
 * deploy.
 *
 * Usage:
 *   npx tsx scripts/backfill-tasks-to-ghl.ts
 *   npx tsx scripts/backfill-tasks-to-ghl.ts --limit=50
 *   npx tsx scripts/backfill-tasks-to-ghl.ts --include-completed
 */
import "dotenv/config";
import { db } from "../lib/db";
import { crmTasks, leads } from "../drizzle/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { syncTaskToGHL } from "../integrations/ghl/sync";

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0") || 0;
  const includeCompleted = args.includes("--include-completed");

  const conditions = [
    isNull(crmTasks.ghlTaskId),
    sql`${leads.ghlContactId} IS NOT NULL`,
  ];
  if (!includeCompleted) conditions.push(eq(crmTasks.status, "open"));

  const rows = await db
    .select({ id: crmTasks.id, title: crmTasks.title, sid: crmTasks.manychatSubId })
    .from(crmTasks)
    .innerJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${crmTasks.manychatSubId})`)
    .where(and(...conditions))
    .limit(limit > 0 ? limit : 10_000);

  console.log(`Found ${rows.length} tasks to backfill (includeCompleted=${includeCompleted})`);
  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    try {
      await syncTaskToGHL(r.id);
      ok++;
      console.log(`  ✓ #${r.id} ${r.title}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ #${r.id} ${r.title}`, e instanceof Error ? e.message : e);
    }
    // gentle rate limit
    await new Promise((res) => setTimeout(res, 120));
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

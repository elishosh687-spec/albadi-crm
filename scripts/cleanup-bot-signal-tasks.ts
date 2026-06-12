/**
 * One-off cleanup: delete ALL legacy signal-derived GHL Contact Tasks (the
 * bot_paused / needs_eli / factory_received / draft_pending / etc. tasks
 * created by lib/ghl-tasks/reconcile.ts) so the salesperson's board is clean.
 *
 * Pairs with the ENABLE_GHL_SIGNAL_TASKS=off kill-switch (config.ts) which
 * stops new ones being created. This removes the backlog + duplicates already
 * in GHL, then clears the `ghl_lead_tasks` cache.
 *
 * Safe: only deletes tasks whose TITLE matches a known bot-signal signature,
 * and never touches a task carrying our own [CALLBACK v1] / [BACKFILL v1]
 * marker. Manually-created tasks (e.g. Eli's test task) are left alone.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/cleanup-bot-signal-tasks.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/cleanup-bot-signal-tasks.ts
 */
import { db } from "../lib/db";
import { leads, ghlLeadTasks, ghlOauthTokens } from "../drizzle/schema";
import { isNotNull, desc } from "drizzle-orm";
import {
  listContactTasks,
  deleteContactTask,
  type GHLContactTask,
} from "../integrations/ghl/client";

// Distinctive Hebrew substrings from each derive.ts task title. Substring
// (not exact) match so older title variants are still caught.
const BOT_SIGNATURES = [
  "טפל באסקלציה", // needs_eli_escalation
  "בוט מושהה", // bot_paused
  "אשר/דחה טיוטה", // draft_pending
  "תמחר הצעת מפעל", // factory_received
  "פנה למפעל", // factory_stuck
  "סגור עסקה גדולה", // big_quote_close
  "פעולה אחרונה לפני", // idle_active_lead
];
// Never delete our own tasks (defensive — they carry these body markers).
const KEEP_MARKERS = ["[CALLBACK v1]", "[BACKFILL v1]"];

function isBotSignalTask(t: GHLContactTask): boolean {
  const body = t.body ?? "";
  if (KEEP_MARKERS.some((m) => body.includes(m))) return false;
  const title = t.title ?? "";
  return BOT_SIGNATURES.some((s) => title.includes(s));
}

async function hydrateGhlEnvFromDb() {
  if (process.env.GHL_LOCATION_ID && process.env.GHL_API_KEY) return;
  const tok = await db
    .select({
      locationId: ghlOauthTokens.locationId,
      accessToken: ghlOauthTokens.accessToken,
    })
    .from(ghlOauthTokens)
    .orderBy(desc(ghlOauthTokens.updatedAt))
    .limit(1);
  if (!tok[0]) throw new Error("No ghl_oauth_tokens row to hydrate env from.");
  if (!process.env.GHL_LOCATION_ID) process.env.GHL_LOCATION_ID = tok[0].locationId;
  if (!process.env.GHL_API_KEY) process.env.GHL_API_KEY = tok[0].accessToken;
  console.log(`(env hydrated from ghl_oauth_tokens: location=${tok[0].locationId})`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await hydrateGhlEnvFromDb();

  const contacts = await db
    .selectDistinct({ contactId: leads.ghlContactId })
    .from(leads)
    .where(isNotNull(leads.ghlContactId));

  console.log(
    `Scanning ${contacts.length} GHL contacts for bot-signal tasks…${dryRun ? "  (DRY RUN)" : ""}\n`,
  );

  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  const byKind: Record<string, number> = {};

  for (const { contactId } of contacts) {
    if (!contactId) continue;
    scanned++;
    let tasks: GHLContactTask[];
    try {
      tasks = await listContactTasks(contactId);
    } catch (e) {
      console.warn(`  ! list failed for ${contactId}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    for (const t of tasks) {
      if (!isBotSignalTask(t)) continue;
      const sig = BOT_SIGNATURES.find((s) => (t.title ?? "").includes(s)) ?? "?";
      byKind[sig] = (byKind[sig] ?? 0) + 1;
      if (dryRun) {
        console.log(`[DRY] would delete  ${t.title}  (contact ${contactId})`);
        deleted++;
        continue;
      }
      try {
        await deleteContactTask(contactId, t.id);
        deleted++;
      } catch (e) {
        failed++;
        console.warn(`  ! delete failed ${t.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // Clear the cache table so it doesn't point at deleted tasks.
  if (!dryRun) {
    await db.delete(ghlLeadTasks);
    console.log("\ncleared ghl_lead_tasks cache table");
  }

  console.log("\nby signature:");
  for (const [sig, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${sig}`);
  }
  console.log(
    `\n${dryRun ? "[DRY] would delete" : "deleted"}=${deleted} failed=${failed} (scanned ${scanned} contacts)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

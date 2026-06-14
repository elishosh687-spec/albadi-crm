/**
 * One-off backfill: create a GHL "callback" task for each EXISTING active lead
 * so the salesperson's "My Day" Tasks board is populated on day one. The
 * call-analysis automation only creates tasks for NEW calls going forward —
 * this seeds the current backlog.
 *
 * Scope: active leads in the sales-owned stages (INTAKE / DISCAVERY /
 * FACTORY_WAIT / CONSIDERATION) that have a GHL contact. NULL-stage
 * (questionnaire, bot-owned) and terminal (WON/LOST) leads are skipped.
 *
 * Due time: the lead's `follow_up_date` if set, else the next work slot —
 * snapped to Sun–Thu 09:00–18:00 Israel via clampToWorkWindow (run it on
 * Thu/Fri so no-date leads land Sunday 09:00).
 *
 * Idempotent: marker `[BACKFILL v1] sid=<sid>` in the task body; scans the
 * contact's existing tasks before creating. Safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=... GHL_SALESPERSON_USER_ID=jTt6f6zPALPW2XVKVqok \
 *     npx tsx scripts/backfill-existing-leads-tasks.ts --dry-run
 *   DATABASE_URL=... GHL_SALESPERSON_USER_ID=jTt6f6zPALPW2XVKVqok \
 *     npx tsx scripts/backfill-existing-leads-tasks.ts
 */
import { db } from "../lib/db";
import { leads, ghlOauthTokens } from "../drizzle/schema";
import { and, eq, inArray, isNotNull, desc } from "drizzle-orm";
import {
  createContactTask,
  listContactTasks,
  updateContactTask,
} from "../integrations/ghl/client";
import { clampToWorkWindow, jerusalemWorkdayAt } from "../lib/clock/callback-window";

const ACTIVE_SALES_STAGES = [
  "INTAKE",
  "DISCAVERY",
  "FACTORY_WAIT",
  "CONSIDERATION",
];
const MARKER_VERSION = "BACKFILL v1";

// Hebrew detection — many bot_summary values are internal English, which the
// (Hebrew-only) salesperson can't read. Use the summary only when it's Hebrew.
const HEBREW = /[֐-׿]/;

// Hebrew, action-oriented title per stage (fallback when summary isn't Hebrew).
const STAGE_TITLE: Record<string, string> = {
  INTAKE: "הצעה אוטומטית נשלחה — לבדוק תגובה",
  DISCAVERY: "שיחת בירור — להמשיך",
  FACTORY_WAIT: "ממתין למפעל — לעקוב",
  CONSIDERATION: "שוקל הצעה / מו״מ — לסגור",
};

// Hebrew stage name for the task body (instead of the English enum).
const STAGE_HE: Record<string, string> = {
  INTAKE: "שאלון + הצעה",
  DISCAVERY: "שיחת בירור",
  FACTORY_WAIT: "בדיקת מפעל",
  CONSIDERATION: "שוקל הצעה / מו״מ",
};

// Call-order priority (Eli 2026-06-14: hot leads first → speed-to-lead).
// Lower rank = earlier on the board. Each rank adds 20 min to the 09:00 base
// so the stages cluster in order when sorted by due time.
const STAGE_PRIORITY: Record<string, number> = {
  INTAKE: 0,
  DISCAVERY: 1,
  FACTORY_WAIT: 2,
  CONSIDERATION: 3,
};

// Same env-hydration trick as scripts/_test-call-pipeline.ts: Vercel's
// encrypted secrets come back empty in `vercel env pull`, so pull the live
// GHL token from the DB when the env vars are missing.
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

function markerFor(sid: string): string {
  return `[${MARKER_VERSION}] sid=${sid}`;
}

function titleFor(lead: {
  pipelineStage: string | null;
  botSummary: string | null;
}): string {
  const summary = (lead.botSummary ?? "").trim();
  // Use the bot summary only if it's actually Hebrew — else a Hebrew stage label.
  if (summary && HEBREW.test(summary)) return `📞 חזרה: ${summary.slice(0, 70)}`;
  return `📞 חזרה: ${STAGE_TITLE[lead.pipelineStage ?? ""] ?? "מעקב"}`;
}

function bodyFor(
  lead: { pipelineStage: string | null; botSummary: string | null },
  marker: string,
): string {
  const lines = [
    marker,
    `שלב: ${STAGE_HE[lead.pipelineStage ?? ""] ?? lead.pipelineStage ?? "—"}`,
  ];
  // Only carry the summary into the body if it's Hebrew.
  if (lead.botSummary && HEBREW.test(lead.botSummary)) {
    lines.push(`סיכום: ${lead.botSummary}`);
  }
  return lines.join("\n");
}

async function dueFor(
  followUpDate: string | null,
  pipelineStage: string | null,
): Promise<Date> {
  const fud = (followUpDate ?? "").trim();
  // Respect a genuine FUTURE scheduled callback (e.g. "call after the holiday").
  if (/^\d{4}-\d{2}-\d{2}/.test(fud)) {
    const d = new Date(`${fud.slice(0, 10)}T00:00:00Z`);
    if (d.getTime() > Date.now() + 12 * 60 * 60 * 1000) {
      return clampToWorkWindow(d);
    }
  }
  // Otherwise this is the kickoff board — schedule today (or next workday),
  // staggered by stage priority so hot leads sort to the top.
  const rank = STAGE_PRIORITY[pipelineStage ?? ""] ?? 4;
  return jerusalemWorkdayAt(9, rank * 20);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await hydrateGhlEnvFromDb();

  const assignedTo = process.env.GHL_SALESPERSON_USER_ID || "";
  if (!assignedTo) {
    console.log("⚠️  GHL_SALESPERSON_USER_ID unset → tasks would be UNASSIGNED.");
  }

  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      ghlContactId: leads.ghlContactId,
      pipelineStage: leads.pipelineStage,
      botSummary: leads.botSummary,
      followUpDate: leads.followUpDate,
    })
    .from(leads)
    .where(
      and(
        eq(leads.active, true),
        isNotNull(leads.ghlContactId),
        inArray(leads.pipelineStage, ACTIVE_SALES_STAGES),
      ),
    );

  console.log(
    `${rows.length} active leads in sales stages with a GHL contact.${dryRun ? "  (DRY RUN)" : ""}\n`,
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const lead of rows) {
    const contactId = lead.ghlContactId!;
    const marker = markerFor(lead.sid);
    const title = titleFor(lead);
    const due = await dueFor(lead.followUpDate, lead.pipelineStage);
    const dueLocal = due.toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const body = bodyFor(lead, marker);

    if (dryRun) {
      console.log(
        `[DRY] ${(lead.name ?? lead.sid).padEnd(28)} ${(lead.pipelineStage ?? "").padEnd(14)} ${dueLocal}  | ${title}`,
      );
      created++;
      continue;
    }

    try {
      const existing = await listContactTasks(contactId);
      const found = existing.find((t) => (t.body ?? "").includes(marker));
      if (found) {
        // Already backfilled — update title/body/dueDate in place if any
        // changed (Hebrew-title fix, priority re-stagger), else leave alone.
        const dueChanged =
          !found.dueDate || new Date(found.dueDate).getTime() !== due.getTime();
        if ((found.title ?? "") !== title || (found.body ?? "") !== body || dueChanged) {
          await updateContactTask(contactId, found.id, {
            title,
            body,
            dueDate: due.toISOString(),
          });
          updated++;
          console.log(
            `↻ ${(lead.name ?? lead.sid).padEnd(28)} ${(lead.pipelineStage ?? "").padEnd(14)} ${dueLocal} | ${title}`,
          );
        } else {
          skipped++;
        }
        continue;
      }
      await createContactTask(contactId, {
        title,
        body,
        dueDate: due.toISOString(),
        assignedTo: assignedTo || undefined,
      });
      created++;
      console.log(
        `✓ ${(lead.name ?? lead.sid).padEnd(28)} ${(lead.pipelineStage ?? "").padEnd(14)} ${dueLocal}`,
      );
    } catch (e) {
      failed++;
      console.warn(
        `✗ ${lead.name ?? lead.sid}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  console.log(
    `\n${dryRun ? "[DRY] would create" : "created"}=${created} updated=${updated} skipped=${skipped} failed=${failed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

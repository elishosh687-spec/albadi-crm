/**
 * POST /api/cron/analyze-active-leads — nightly LLM analysis over all active
 * leads that don't have a fresh verdict yet. Feeds the pipeline audit's
 * "commitment score" gate, so DISCAVERY/CONSIDERATION suggestions only fire
 * on customers the analyst confirms are actually engaged.
 *
 * Auth: Bearer BOT_SECRET (or CALL_TRIGGER_SECRET, same as process-recordings).
 * Trigger: Vercel Cloud Routine, daily.
 *
 * Selection rule: active=true AND (no lead_analyses row OR latest.created_at
 * older than FRESHNESS_HOURS). Caps at MAX_PER_TICK so a single run stays
 * within maxDuration + the OpenAI TPM budget.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmTasks } from "@/drizzle/schema";
import { analyzeLead } from "@/lib/analysis/analyze-lead";
import { GHL_SALESPERSON_USER_ID } from "@/integrations/ghl/config";
import { updateContactTask } from "@/integrations/ghl/client";
import { syncTaskToGHL } from "@/integrations/ghl/sync";
import { leads } from "@/drizzle/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FRESHNESS_HOURS = 24;
// Cap per invocation. gpt-4o ~ 30k TPM tier + concurrency 3 → ~30 leads fit
// comfortably in 5min. Bigger backlogs drain across successive daily ticks.
const MAX_PER_TICK = 40;
const CONCURRENCY = 3;

function authorized(req: NextRequest): boolean {
  // Vercel Cron sends `Bearer $CRON_SECRET`; manual/local triggers use
  // BOT_SECRET or CALL_TRIGGER_SECRET.
  const accepted = [
    process.env.BOT_SECRET,
    process.env.CALL_TRIGGER_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return accepted.some((s) => header === `Bearer ${s}`);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Active leads whose latest verdict is missing or stale.
  const rows = await db.execute<{ sid: string }>(sql`
    SELECT l.manychat_sub_id AS sid
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT created_at
      FROM lead_analyses a
      WHERE a.manychat_sub_id = l.manychat_sub_id
      ORDER BY created_at DESC
      LIMIT 1
    ) la ON true
    WHERE l.active = true
      AND (la.created_at IS NULL
        OR la.created_at < now() - (${FRESHNESS_HOURS} || ' hours')::interval)
      -- Skip terminal leads — WON/LOST verdicts don't age meaningfully.
      AND (l.pipeline_stage IS NULL OR l.pipeline_stage NOT IN ('WON','LOST'))
    ORDER BY la.created_at NULLS FIRST, l.updated_at DESC
    LIMIT ${MAX_PER_TICK}
  `);

  const queue = (rows.rows as { sid: string }[]).map((r) => r.sid);

  const results: { sid: string; ok: boolean; cached?: boolean; error?: string }[] = [];
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const chunk = queue.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((sid) => analyzeLead(sid))
    );
    settled.forEach((s, j) => {
      const sid = chunk[j];
      if (s.status === "fulfilled" && s.value) {
        results.push({ sid, ok: true, cached: s.value.cached });
      } else {
        results.push({
          sid,
          ok: false,
          error:
            s.status === "rejected"
              ? String(s.reason).slice(0, 200)
              : "no verdict",
        });
      }
    });
  }

  const okCount = results.filter((r) => r.ok).length;

  // Same tick — sweep any open crm_tasks that landed without an owner and
  // assign them to Itay. New tasks already default to Itay (auto-task.ts +
  // createCrmTaskAction), but this covers rows that were created before the
  // fix + any edge case that slipped through. Per Eli 2026-07-01.
  const ownerSweep = await sweepOrphanTasks();

  // Same tick — CREATE in GHL any open task that never got pushed (ghl_task_id
  // IS NULL). Without this, an auto-task lives only in the DB (invisible to Itay
  // in GHL) while the pipeline-audit counts it as handled → the lead falls
  // between both chairs. auto-task.ts now syncs on creation, but this covers
  // rows created before that fix + brand-new leads that got a ghl_contact_id
  // only after the task was made.
  const pushSweep = await pushUnsyncedTasks();

  return NextResponse.json({
    ok: true,
    processed: results.length,
    ok_count: okCount,
    fail_count: results.length - okCount,
    remaining_estimate: queue.length === MAX_PER_TICK ? "unknown_more" : 0,
    owner_sweep: ownerSweep,
    push_sweep: pushSweep,
    results,
  });
}

/**
 * Create in GHL any OPEN crm_task that never got pushed (ghl_task_id IS NULL),
 * for active (non-WON/LOST) leads that already have a ghl_contact_id. Bounded
 * per tick to stay under GHL rate limits; the next tick picks up the rest.
 */
async function pushUnsyncedTasks(): Promise<{ found: number; pushed: number }> {
  if (!GHL_SALESPERSON_USER_ID) return { found: 0, pushed: 0 };
  const CAP = 25;
  const rows = await db
    .select({ id: crmTasks.id })
    .from(crmTasks)
    .leftJoin(leads, eq(leads.manychatSubId, crmTasks.manychatSubId))
    .where(
      and(
        isNull(crmTasks.completedAt),
        eq(crmTasks.status, "open"),
        isNull(crmTasks.ghlTaskId),
        isNotNull(leads.ghlContactId),
        or(isNull(leads.pipelineStage), sql`${leads.pipelineStage} NOT IN ('WON','LOST')`)
      )
    )
    .limit(CAP);
  let pushed = 0;
  for (const r of rows) {
    try {
      await syncTaskToGHL(r.id);
      pushed++;
    } catch (e) {
      console.warn("[analyze-active-leads] task create-push failed", r.id, e);
    }
  }
  return { found: rows.length, pushed };
}

async function sweepOrphanTasks(): Promise<{
  found: number;
  updated: number;
  ghlPushed: number;
}> {
  if (!GHL_SALESPERSON_USER_ID) return { found: 0, updated: 0, ghlPushed: 0 };
  const rows = await db
    .select({
      id: crmTasks.id,
      title: crmTasks.title,
      dueAt: crmTasks.dueAt,
      status: crmTasks.status,
      ghlTaskId: crmTasks.ghlTaskId,
      ghlContactId: leads.ghlContactId,
    })
    .from(crmTasks)
    .leftJoin(leads, eq(leads.manychatSubId, crmTasks.manychatSubId))
    .where(
      and(
        isNull(crmTasks.completedAt),
        or(isNull(crmTasks.assignedTo), eq(crmTasks.assignedTo, sql`''`))
      )
    );
  if (!rows.length) return { found: 0, updated: 0, ghlPushed: 0 };
  await db
    .update(crmTasks)
    .set({ assignedTo: GHL_SALESPERSON_USER_ID, updatedAt: new Date() })
    .where(
      and(
        isNull(crmTasks.completedAt),
        or(isNull(crmTasks.assignedTo), eq(crmTasks.assignedTo, sql`''`))
      )
    );
  let ghlPushed = 0;
  for (const r of rows) {
    if (!r.ghlTaskId || !r.ghlContactId) continue;
    try {
      const dueIso = (r.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000))
        .toISOString();
      await updateContactTask(r.ghlContactId, r.ghlTaskId, {
        title: r.title,
        dueDate: dueIso,
        completed: r.status === "completed",
        assignedTo: GHL_SALESPERSON_USER_ID,
      });
      ghlPushed++;
    } catch (e) {
      console.warn("[analyze-active-leads] task push failed", r.id, e);
    }
  }
  return { found: rows.length, updated: rows.length, ghlPushed };
}

// Vercel Cron pings GET. Alias to POST so a single implementation drives both.
export async function GET(req: NextRequest) {
  return POST(req);
}

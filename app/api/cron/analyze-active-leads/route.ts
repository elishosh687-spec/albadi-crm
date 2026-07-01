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
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { analyzeLead } from "@/lib/analysis/analyze-lead";

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
  return NextResponse.json({
    ok: true,
    processed: results.length,
    ok_count: okCount,
    fail_count: results.length - okCount,
    remaining_estimate: queue.length === MAX_PER_TICK ? "unknown_more" : 0,
    results,
  });
}

// Vercel Cron pings GET. Alias to POST so a single implementation drives both.
export async function GET(req: NextRequest) {
  return POST(req);
}

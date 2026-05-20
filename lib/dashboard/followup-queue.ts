/**
 * Compute the followup queue — used by both:
 *   - app/dashboard/v3/followups/page.tsx (displays the queue)
 *   - app/dashboard/v3/page.tsx (neighbor list for prev/next when from=followup)
 *
 * Mirrors the cadence rules from app/api/bot/followups/route.ts so the
 * displayed order matches the cron's actual send order.
 */

import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";

const HOUR_MS = 60 * 60 * 1000;
const MAX_FOLLOWUPS = 3;
const QUIET_START = 21; // 21:00 IL
const QUIET_END = 9; // 09:00 IL

const CADENCE_BY_STAGE: Record<string, number[]> = {
  NEW: [1 * HOUR_MS, 1 * HOUR_MS, 1 * HOUR_MS],
  AWAITING_ESTIMATE: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
  AWAITING_LOGO: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
  AWAITING_FINAL: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
};

function jerusalemHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? Number(hourPart.value) : 0;
}

function isQuietAt(at: Date): boolean {
  const h = jerusalemHour(at);
  return h >= QUIET_START || h < QUIET_END;
}

function adjustForQuietHours(at: Date): Date {
  if (!isQuietAt(at)) return at;
  let candidate = new Date(at);
  for (let i = 0; i < 50; i++) {
    candidate = new Date(candidate.getTime() + 30 * 60 * 1000);
    if (!isQuietAt(candidate)) return candidate;
  }
  return candidate;
}

export interface FollowupQueueItem {
  sid: string;
  nextEligibleAt: Date;
}

/**
 * Return followup queue ordered by next-eligible-at (asc).
 * Filters out terminal/non-followup stages, completed questionnaires,
 * and leads that already exhausted attempts.
 */
export async function loadFollowupQueue(): Promise<FollowupQueueItem[]> {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      stage: leads.pipelineStage,
      qState: leads.qState,
      followUpCount: leads.followUpCount,
      lastFollowUpAt: leads.lastFollowUpAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  const now = Date.now();
  const queue: FollowupQueueItem[] = [];

  for (const r of rows) {
    const stage = (r.stage ?? "").toUpperCase();
    if (stage === "WON" || stage === "DROPPED") continue;
    if (stage === "WAITING_FACTORY") continue;

    let cadences: number[] | null = null;
    if (!stage || stage === "NEW") {
      const q = r.qState as any;
      if (!q || q.bailed || q.doneAt) continue;
      if (typeof q.step !== "number" || q.step < 2 || q.step > 7) continue;
      cadences = CADENCE_BY_STAGE.NEW;
    } else if (CADENCE_BY_STAGE[stage]) {
      cadences = CADENCE_BY_STAGE[stage];
    }
    if (!cadences) continue;

    const attempt = r.followUpCount ?? 0;
    if (attempt >= MAX_FOLLOWUPS) continue;

    const cadenceIdx = Math.min(attempt, cadences.length - 1);
    const waitMs = cadences[cadenceIdx];
    const lastTs = r.lastFollowUpAt?.getTime() ?? now;
    const rawNext = new Date(lastTs + waitMs);
    const nextEligibleAt = adjustForQuietHours(rawNext);

    queue.push({ sid: r.sid, nextEligibleAt });
  }

  queue.sort((a, b) => a.nextEligibleAt.getTime() - b.nextEligibleAt.getTime());
  return queue;
}

export async function loadFollowupQueueSids(): Promise<string[]> {
  const queue = await loadFollowupQueue();
  return queue.map((q) => q.sid);
}

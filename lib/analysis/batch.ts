/**
 * Filtered batch analysis — drives the "ניתוח לידים" screen.
 *
 * selectMatchedSids: leads matching a filter (stage / date / has-calls).
 * analyzeBatch: analyze the next N matched-but-unanalyzed leads (cached ones
 *   are skipped for free), returning progress so the UI can show "X of Y" and
 *   a "המשך" button for the next chunk.
 *
 * Shared by the admin route, the widget endpoint, and the v3 server action so
 * the selection/progress logic lives in exactly one place.
 */

import { db } from "@/lib/db";
import { sql, type SQL } from "drizzle-orm";
import { analyzeLead } from "./analyze-lead";

export interface LeadFilter {
  /** pipeline_stage values; empty/undefined = any. Use "__NULL__" for NULL stage. */
  stages?: string[];
  /** ISO date (inclusive) on leads.created_at. */
  dateFrom?: string;
  /** ISO date (inclusive) on leads.created_at. */
  dateTo?: string;
  /** Only leads with at least one transcribed call. */
  withCalls?: boolean;
}

const CONCURRENCY = 3;

function buildConditions(f: LeadFilter): SQL[] {
  const conds: SQL[] = [sql`l.active = true`];

  const stages = (f.stages ?? []).filter(Boolean);
  if (stages.length) {
    const hasNull = stages.includes("__NULL__");
    const real = stages.filter((s) => s !== "__NULL__");
    const parts: SQL[] = [];
    if (real.length)
      parts.push(sql`l.pipeline_stage IN (${sql.join(real.map((s) => sql`${s}`), sql`, `)})`);
    if (hasNull) parts.push(sql`l.pipeline_stage IS NULL`);
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  if (f.dateFrom) conds.push(sql`l.created_at >= ${f.dateFrom}`);
  if (f.dateTo) conds.push(sql`l.created_at <= ${f.dateTo}`);
  if (f.withCalls)
    conds.push(sql`EXISTS (
      SELECT 1 FROM call_recording_imports c
      WHERE c.ghl_contact_id = l.ghl_contact_id AND c.transcript IS NOT NULL
    )`);
  return conds;
}

/** All matched sids, newest activity first, with an `analyzed` flag. */
export async function selectMatched(
  f: LeadFilter
): Promise<{ sid: string; analyzed: boolean }[]> {
  const where = sql.join(buildConditions(f), sql` AND `);
  const res = await db.execute(sql`
    SELECT l.manychat_sub_id AS sid,
           EXISTS (SELECT 1 FROM lead_analyses a WHERE a.manychat_sub_id = l.manychat_sub_id) AS analyzed
    FROM leads l
    WHERE ${where}
    ORDER BY l.updated_at DESC
  `);
  return (res.rows as { sid: string; analyzed: boolean }[]).map((r) => ({
    sid: r.sid,
    analyzed: !!r.analyzed,
  }));
}

export interface BatchProgress {
  total: number;
  analyzed_before: number;
  processed: number;
  analyzed_after: number;
  remaining: number;
  results: { sid: string; ok: boolean; blocker?: string; cached?: boolean; error?: string }[];
}

/**
 * Analyze up to `limit` matched leads. By default picks the next UNANALYZED
 * ones; with force=true re-analyzes from the top (newest first).
 */
export async function analyzeBatch(
  f: LeadFilter,
  limit: number,
  force = false
): Promise<BatchProgress> {
  const matched = await selectMatched(f);
  const total = matched.length;
  const analyzedBefore = matched.filter((m) => m.analyzed).length;

  const queue = (force ? matched : matched.filter((m) => !m.analyzed)).slice(0, limit);

  const results: BatchProgress["results"] = [];
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const chunk = queue.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((m) => analyzeLead(m.sid, { force }))
    );
    settled.forEach((s, j) => {
      const sid = chunk[j].sid;
      if (s.status === "fulfilled" && s.value) {
        results.push({
          sid,
          ok: true,
          cached: s.value.cached,
          blocker: s.value.verdict.primary_blocker,
        });
      } else {
        results.push({
          sid,
          ok: false,
          error: s.status === "rejected" ? String(s.reason) : "lead not found",
        });
      }
    });
  }

  const newlyAnalyzed = results.filter((r) => r.ok && !force).length;
  return {
    total,
    analyzed_before: analyzedBefore,
    processed: results.length,
    analyzed_after: force ? analyzedBefore : analyzedBefore + newlyAnalyzed,
    remaining: force
      ? Math.max(0, total - results.length)
      : Math.max(0, total - (analyzedBefore + newlyAnalyzed)),
    results,
  };
}

/** Build the same WHERE for the aggregate, scoping verdicts to matched leads. */
export function matchedSidsSubquery(f: LeadFilter): SQL {
  const where = sql.join(buildConditions(f), sql` AND `);
  return sql`SELECT l.manychat_sub_id FROM leads l WHERE ${where}`;
}

/**
 * POST /api/admin/analyze-leads
 *
 * Batch-seed the per-lead analysis table (so the aggregate report + the "נתח"
 * button are instant). Runs in prod where OPENAI/GHL keys exist. Processes
 * leads with activity, newest first, skipping unchanged ones (input-hash cache)
 * unless ?force=1. Capped per call to stay within maxDuration; re-run to
 * continue (cached leads are near-free).
 *
 * Auth: Bearer BOT_SECRET.
 * Query: ?limit=N (1..60, default 15) · ?force=1 · ?withCallsOnly=1
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { analyzeLead } from "@/lib/analysis/analyze-lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 3;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "15");
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 15, 1), 60);
  const force = url.searchParams.get("force") === "1";
  const withCallsOnly = url.searchParams.get("withCallsOnly") === "1";

  // Leads with some activity, newest first. When withCallsOnly, restrict to
  // leads whose GHL contact has a transcribed call (the richest dossiers).
  const rows = withCallsOnly
    ? await db.execute(sql`
        SELECT DISTINCT l.manychat_sub_id AS sid, l.updated_at
        FROM leads l
        JOIN call_recording_imports c ON c.ghl_contact_id = l.ghl_contact_id
        WHERE c.transcript IS NOT NULL
        ORDER BY l.updated_at DESC
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT manychat_sub_id AS sid, updated_at
        FROM leads
        WHERE active = true
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `);

  const sids = (rows.rows as { sid: string }[]).map((r) => r.sid);

  const results: { sid: string; ok: boolean; cached?: boolean; blocker?: string; error?: string }[] =
    [];
  for (let i = 0; i < sids.length; i += CONCURRENCY) {
    const batch = sids.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((sid) => analyzeLead(sid, { force }))
    );
    settled.forEach((s, j) => {
      const sid = batch[j];
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
          error:
            s.status === "rejected"
              ? String(s.reason)
              : "lead not found",
        });
      }
    });
  }

  const ok = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    processed: results.length,
    succeeded: ok,
    failed: results.length - ok,
    results,
  });
}

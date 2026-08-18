/**
 * GET /api/admin/meta-lead-count?since=YYYY-MM-DD&until=YYYY-MM-DD
 *
 * How many Facebook-sourced leads actually LANDED in the CRM in a window.
 *
 * This exists to be the independent second opinion on Meta's own numbers.
 * Meta reports the same conversion under many `action_type` rows in parallel
 * (five of them read 21 for one week; eight purchase rows read 1), so a naive
 * sum inflates the count 5-8x. No rule written inside the Meta pipeline can
 * prove the surviving number is TRUE — only a source that isn't Meta can.
 * Measured 2026-08-18: Meta `lead`=21 vs 20 here, and 42 vs 39 the week
 * before. See marketing/shared/meta_insights.py.
 *
 * It catches the opposite failure too, which matters more operationally:
 * Meta counting leads that never reached us means the form->CRM path broke.
 *
 * Both dates are INCLUSIVE, matching Meta's `time_range`. `created_at` is UTC
 * while the ad account has its own timezone, so a 1-day boundary drift is
 * expected — compare with tolerance, not for equality.
 *
 * Auth: Bearer BOT_SECRET / CALL_TRIGGER_SECRET / CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const accepted = [
    process.env.BOT_SECRET,
    process.env.CALL_TRIGGER_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return accepted.some((s) => header === `Bearer ${s}`);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? "";
  const until = url.searchParams.get("until") ?? "";
  if (!DATE.test(since) || !DATE.test(until)) {
    return NextResponse.json(
      { ok: false, error: "since/until required as YYYY-MM-DD (both inclusive)" },
      { status: 400 },
    );
  }

  // `until` is inclusive, so the upper bound is the day AFTER it.
  const res = await db.execute<{
    all_leads: number;
    facebook: number;
    with_leadgen: number;
  }>(sql`
    SELECT count(*)::int AS all_leads,
           count(*) FILTER (
             WHERE lead_source = 'facebook' OR source = 'facebook_import'
           )::int AS facebook,
           count(*) FILTER (WHERE meta_leadgen_id IS NOT NULL)::int AS with_leadgen
    FROM leads
    WHERE created_at >= ${since}::date
      AND created_at <  (${until}::date + interval '1 day')`);

  const r = res.rows[0];
  return NextResponse.json({
    ok: true,
    since,
    until,
    timezone: "UTC (leads.created_at)",
    // The headline number: what the Meta `lead` count should agree with.
    facebookSourced: Number(r?.facebook ?? 0),
    // Narrower — only leads the attribution cron already matched to a form.
    withLeadgenId: Number(r?.with_leadgen ?? 0),
    allNewLeads: Number(r?.all_leads ?? 0),
  });
}

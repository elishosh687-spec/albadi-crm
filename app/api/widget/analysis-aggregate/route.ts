/**
 * GET /api/widget/analysis-aggregate — deterministic rollup ("why aren't leads
 * closing") over stored verdicts, optionally scoped to a filter. Also returns
 * the matched/analyzed counts so the screen can show progress before running.
 *
 * Auth: ?widget_token=... Query: stages, dateFrom, dateTo, withCalls
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { aggregateAnalyses } from "@/lib/analysis/aggregate";
import { selectMatched, type LeadFilter } from "@/lib/analysis/batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token");
  if (!verifyWidgetToken(token)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const stages = sp.get("stages");
  const filter: LeadFilter = {
    stages: stages ? stages.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    withCalls: sp.get("withCalls") === "1",
  };

  const [aggregate, matched] = await Promise.all([
    aggregateAnalyses(filter),
    selectMatched(filter),
  ]);
  return NextResponse.json({
    ok: true,
    aggregate,
    matched_total: matched.length,
    matched_analyzed: matched.filter((m) => m.analyzed).length,
  });
}

/**
 * GET /api/widget/decisions?widget_token=...&lead=<sid>&limit=50&action=<filter>&source=<filter>
 *
 * Read-only feed of bot_decision_log for a lead. Powers the
 * /widget/bot-decisions sidebar widget.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { listDecisions } from "@/lib/supervisor/server/listDecisions";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog("widget", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10) || 50;
  const rows = await listDecisions({
    lead: url.searchParams.get("lead") ?? undefined,
    action: url.searchParams.get("action") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    limit,
  });
  return NextResponse.json({ ok: true, count: rows.length, rows });
});

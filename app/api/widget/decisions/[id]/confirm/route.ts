/**
 * POST /api/widget/decisions/:id/confirm — Eli says "the LLM was right".
 * Auth: widget_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { confirmDecision } from "@/lib/supervisor/server/feedback";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";

export const POST = withRequestLog("widget", async (req: NextRequest, log, { params }: { params: Promise<{ id: string }> }) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const rowId = parseInt(id, 10);
  const r = await confirmDecision(rowId);
  log.info("decision.confirmed", { rowId, ok: r.ok });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
});

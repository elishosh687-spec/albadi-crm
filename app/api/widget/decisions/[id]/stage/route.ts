/**
 * POST /api/widget/decisions/:id/stage — Eli moves the lead to a specific
 * pipeline stage as part of correcting a bot decision. Updates both the
 * leads row and the bot_decision_log (eli_stage_to + eli_action). Also
 * mirrors the move to GHL so the pipeline view stays in sync.
 *
 * Body: { stage: V2PipelineStage }
 * Auth: widget_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { overrideDecisionStage } from "@/lib/supervisor/server/feedback";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const rowId = parseInt(id, 10);
  const body = await req.json().catch(() => ({}));
  const stage = typeof body?.stage === "string" ? body.stage : "";
  const r = await overrideDecisionStage(rowId, stage);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

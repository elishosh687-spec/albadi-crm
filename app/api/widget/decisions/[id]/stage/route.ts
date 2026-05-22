/**
 * POST /api/widget/decisions/:id/stage — Eli corrects the lead's pipeline stage.
 * Body: { stage: string } — must be a V2_PIPELINE_STAGES value.
 * Updates leads.pipeline_stage + bot_decision_log.eliStageTo.
 * Auth: widget_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { overrideDecisionStage } from "@/lib/supervisor/server/feedback";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/stages";

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
  if (!Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const stage = typeof body?.stage === "string" ? body.stage.trim() : "";
  if (!(V2_PIPELINE_STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json({ ok: false, error: "invalid stage" }, { status: 400 });
  }
  const r = await overrideDecisionStage(rowId, stage);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

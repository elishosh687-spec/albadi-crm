/**
 * POST /api/widget/decisions/:id/correct — Eli says "the LLM was wrong, the
 * intent was actually X". Body: { intent: string, note?: string }.
 * Auth: widget_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { correctDecisionIntent } from "@/lib/supervisor/server/feedback";

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
  const intent = typeof body?.intent === "string" ? body.intent : "";
  const note = typeof body?.note === "string" ? body.note : undefined;
  const r = await correctDecisionIntent(rowId, intent, note);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

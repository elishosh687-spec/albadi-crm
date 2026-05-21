/**
 * POST /api/widget/decisions/:id/confirm — Eli says "the LLM was right".
 * Auth: widget_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { confirmDecision } from "@/lib/supervisor/server/feedback";

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
  const r = await confirmDecision(rowId);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

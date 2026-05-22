/**
 * POST /api/widget/toggle-pause?widget_token=...
 *
 * Toggle bot_paused for a single lead from the inbox widget.
 * Body: { sid: string, paused: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { setBotPaused } from "@/app/actions/v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { sid?: string; paused?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const sid = typeof body.sid === "string" ? body.sid.trim() : "";
  const paused = body.paused === true;
  if (!sid) return NextResponse.json({ ok: false, error: "missing sid" }, { status: 400 });

  const result = await setBotPaused(sid, paused);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, paused });
}

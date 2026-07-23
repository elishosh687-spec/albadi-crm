/**
 * POST /api/widget/factory/close-deal/<id>?widget_token=...
 * Body: { closed: boolean }  (default true)
 *
 * "סגור עסקה" — pull a finalized quote into the עסקאות tab (or remove it),
 * decoupled from the lead's WON pipeline stage.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { setDealClosed } from "@/lib/factory/server/closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { closed?: boolean };
  const closed = body.closed !== false;
  try {
    await setDealClosed(id, closed);
    return NextResponse.json({ ok: true, closed });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/widget/factory/closed?widget_token=...
 * Lists every WON + finalized factory quote with its planned pricing snapshot
 * and any saved actual-cost reconciliation. Feeds the "הצעות שנסגרו" screen.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { listClosedQuotes } from "@/lib/factory/server/closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const quotes = await listClosedQuotes();
  return NextResponse.json({ ok: true, quotes });
}

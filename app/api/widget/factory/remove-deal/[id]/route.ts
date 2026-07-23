/**
 * POST /api/widget/factory/remove-deal/<id>?widget_token=...
 *
 * "הסר מעסקאות" — reversible removal of a deal (single or combined) from the
 * עסקאות tab. Clears closed_deal_at on all members + unbinds the group; the
 * underlying quote(s) stay in "הצעות מפעל" and can be re-closed. Returns
 * `stillWon` so the UI can warn when a WON lead keeps the deal visible.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { removeDeal } from "@/lib/factory/server/closed";

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
  try {
    const { stillWon } = await removeDeal(id);
    return NextResponse.json({ ok: true, stillWon });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}

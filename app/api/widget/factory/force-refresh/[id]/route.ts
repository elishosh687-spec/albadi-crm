/**
 * POST /api/widget/factory/force-refresh/[id]?widget_token=...
 *
 * Re-pull ONE quote's factory row from Feishu even when it's already finalized —
 * the scheduled refresh skips finalized rows on purpose. Updates factory_response
 * only; never re-prices. See lib/factory/server/force-refresh.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { forceRefreshQuote } from "@/lib/factory/server/force-refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }
  const result = await forceRefreshQuote(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}

/**
 * POST /api/widget/factory/[id]/clone?widget_token=...
 * Clones a factory quote row to a fresh row at status='received' so it can be
 * re-finalized without overwriting the original. See lib/factory/clone-quote.
 */

import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { cloneFactoryQuote } from "@/lib/factory/clone-quote";

export const runtime = "nodejs";

export const POST = withRequestLog("factory", async (
  req: NextRequest,
  log,
  ctx: { params: Promise<{ id: string }> }
) => {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const result = await cloneFactoryQuote(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, ...result.result });
});

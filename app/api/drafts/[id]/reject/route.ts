/**
 * POST /api/drafts/:id/reject
 *
 * Reject a pending draft. Does not send anything; marks status='rejected'
 * with an optional reason for analytics.
 *
 * Auth: Bearer BOT_SECRET.
 *
 * Body: { reason?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { rejectDraft } from "@/lib/drafts";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const maxDuration = 10;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export const POST = withRequestLog("bot", async (req: NextRequest, log, ctx: { params: Promise<{ id: string }> }) => {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const draftId = Number(id);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { reason?: string } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result = await rejectDraft(
    draftId,
    typeof body.reason === "string" ? body.reason : undefined
  );

  if (!result.ok) {
    log.warn("draft.reject_failed", { draftId, error: (result as { error?: string }).error });
    return NextResponse.json(result, { status: 400 });
  }
  log.info("draft.rejected", { draftId, hasReason: typeof body.reason === "string" });
  return NextResponse.json(result);
});

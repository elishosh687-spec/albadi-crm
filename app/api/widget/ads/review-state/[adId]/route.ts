/**
 * One exact Ad ID's approved review state.
 *
 * GET → { state, audit }.
 * PUT → { approvedStatus?, segment?, role?, adSetId?, reason } — an internal
 *       CRM decision. A status change requires a reason. It never calls Meta.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { normalizeAdId } from "@/lib/ads/ad-id";
import { validateReviewPatch } from "@/lib/ads/review-state";
import { getReviewState, setReviewState } from "@/lib/ads/review-state-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ adId: string }> };

export const GET = withRequestLog("meta", async (req: NextRequest, log, ctx: Ctx) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const adId = normalizeAdId(decodeURIComponent((await ctx.params).adId));
  if (!adId) return NextResponse.json({ ok: false, error: "Ad ID לא תקין" }, { status: 400 });
  return NextResponse.json({ ok: true, ...(await getReviewState(adId)) });
});

export const PUT = withRequestLog("meta", async (req: NextRequest, log, ctx: Ctx) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const v = validateReviewPatch(decodeURIComponent((await ctx.params).adId), body);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const r = await setReviewState(v.adId, v.patch, { reason: v.reason, actor: "widget" });
  return NextResponse.json({ ok: true, ...r });
});

/**
 * Every saved approved review state (per exact Ad ID). Read-only list.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { listReviewState } from "@/lib/ads/review-state-store";

export const dynamic = "force-dynamic";

export const GET = withRequestLog("meta", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, states: await listReviewState() });
});

/**
 * Live Meta ad recommendations for the "מודעות → המלצות" view.
 *
 * Read-only: Meta evidence (exact Ad ID), CRM evidence and Eli's approved
 * statuses in, deterministic recommendations out. `?fresh=1` bypasses the
 * 10-minute Meta cache. A Meta outage still answers 200 — every row then says
 * "לא ניתן להכריע" and `health.meta` carries the reason for the screen.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { buildRecommendations } from "@/lib/ads/build-recommendations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withRequestLog("meta", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const report = await buildRecommendations({ fresh: req.nextUrl.searchParams.get("fresh") === "1" });
  return NextResponse.json({ ok: true, ...report });
});

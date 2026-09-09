/**
 * GET  /api/widget/plays — current editable sales plays (merged over defaults).
 * POST /api/widget/plays — save edited plays. Body: { plays: PlaysMap }
 * Auth: ?widget_token=...
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { loadPlays, savePlays } from "@/lib/sales/plays-store";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const t =
    req.nextUrl.searchParams.get("widget_token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;
  return verifyWidgetToken(t);
}

export const GET = withRequestLog("widget", async (req: NextRequest, log) => {
  if (!authed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, plays: await loadPlays() });
});

export const POST = withRequestLog("widget", async (req: NextRequest, log) => {
  if (!authed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    await savePlays(body.plays ?? {});
    log.info("plays.saved", { keys: Object.keys(body.plays ?? {}).length });
    return NextResponse.json({ ok: true, plays: await loadPlays() });
  } catch (e) {
    log.error("plays.save_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "save failed" },
      { status: 500 }
    );
  }
});

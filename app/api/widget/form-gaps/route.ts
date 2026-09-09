/**
 * GET /api/widget/form-gaps — leads that filled the Facebook lead form but are
 * NOT in the CRM (cross-checked against the `leads` table by phone). This is
 * stronger than the SENT-marker classification: it catches rows marked "sent"
 * that still have no lead row (created-then-purged / transient insert failure).
 *
 * Auth: ?widget_token=...
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { loadFormGapsVsDb } from "@/lib/sheets/lead-gaps";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withRequestLog("widget", async (req: NextRequest, log) => {
  const token = req.nextUrl.searchParams.get("widget_token");
  if (!verifyWidgetToken(token)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const snap = await loadFormGapsVsDb();
    return NextResponse.json({ ok: true, ...snap });
  } catch (e) {
    log.error("form_gaps.failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
});

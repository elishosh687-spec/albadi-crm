/**
 * POST /api/widget/analyze-batch  — filtered batch analysis from the widget
 * "ניתוח לידים" screen. Analyzes the next N matched leads, returns progress.
 *
 * Auth: ?widget_token=... (or Bearer). Body: { stages?, dateFrom?, dateTo?,
 * withCalls?, limit?, force? }
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { analyzeBatch, type LeadFilter } from "@/lib/analysis/batch";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withRequestLog("analysis", async (req: NextRequest, log) => {
  const token =
    req.nextUrl.searchParams.get("widget_token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;
  if (!verifyWidgetToken(token)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty ok */
  }
  const filter: LeadFilter = {
    stages: Array.isArray(body.stages) ? body.stages.map(String).filter(Boolean) : undefined,
    dateFrom: typeof body.dateFrom === "string" && body.dateFrom ? body.dateFrom : undefined,
    dateTo: typeof body.dateTo === "string" && body.dateTo ? body.dateTo : undefined,
    withCalls: body.withCalls === true,
  };
  const rawLimit = Number(body.limit ?? 15);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 15, 1), 60);
  const force = body.force === true;

  try {
    const progress = await analyzeBatch(filter, limit, force);
    log.info("batch.done", { limit, force, ...progress });
    return NextResponse.json({ ok: true, ...progress });
  } catch (e) {
    log.error("batch.failed", e, { limit, force });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "batch failed" },
      { status: 500 }
    );
  }
});

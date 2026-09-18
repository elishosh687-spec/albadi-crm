/**
 * /api/factory/refresh
 *
 * - POST: dashboard "🔄 רענן" button (cookie-auth via middleware).
 * - GET:  Vercel cron every 5 min. Bearer-auth via CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { cronBearerOk } from "@/lib/observability/cron-auth";
import { withRequestLog } from "@/lib/observability/log";
import { withJob } from "@/lib/observability/jobs";
import { refreshFromFeishu } from "@/lib/factory/server/refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = withRequestLog("factory", async (_req: NextRequest, log) => {
  const result = await refreshFromFeishu();
  return NextResponse.json(result);
});

export const GET = withJob("factory-refresh", "factory", async (req: NextRequest, log) => {
  // Inline on purpose (not an `authorized()` helper): the POST beside it is the
  // dashboard button, gated by the middleware cookie, and the route-gate sweep
  // treats a declared `authorized()` as covering every method.
  if (!cronBearerOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await refreshFromFeishu();
  return NextResponse.json(result);
});

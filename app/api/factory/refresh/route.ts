/**
 * /api/factory/refresh
 *
 * - POST: dashboard "🔄 רענן" button (cookie-auth via middleware).
 * - GET:  Vercel cron every 5 min. Bearer-auth via CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
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
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const result = await refreshFromFeishu();
  return NextResponse.json(result);
});

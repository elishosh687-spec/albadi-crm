/**
 * /api/factory/refresh
 *
 * - POST: dashboard "🔄 רענן" button (cookie-auth via middleware).
 * - GET:  Vercel cron every 5 min. Bearer-auth via CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshFromFeishu } from "@/lib/factory/server/refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const result = await refreshFromFeishu();
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const result = await refreshFromFeishu();
  return NextResponse.json(result);
}

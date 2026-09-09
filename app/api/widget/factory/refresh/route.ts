/**
 * POST /api/widget/factory/refresh?widget_token=...
 * Scans pending requests for factory replies in Feishu.
 */

import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { refreshFromFeishu } from "@/lib/factory/server/refresh";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = withRequestLog("factory", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await refreshFromFeishu();
  return NextResponse.json(result);
});

/**
 * GET /api/widget/factory/list?widget_token=...&lead=<sid>&status=<status>
 *
 * Same shape as /api/factory/list — used by widget panel mounts.
 */

import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { listFactoryQuotes } from "@/lib/factory/server/list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog("factory", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const requests = await listFactoryQuotes({
    status: url.searchParams.get("status") ?? undefined,
    lead: url.searchParams.get("lead") ?? undefined,
  });
  return NextResponse.json({ ok: true, requests });
});

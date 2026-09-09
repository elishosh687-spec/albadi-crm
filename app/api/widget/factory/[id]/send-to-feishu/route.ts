/**
 * POST /api/widget/factory/[id]/send-to-feishu?widget_token=...
 * Promotes a draft row to pending by appending to Feishu.
 */

import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { promoteDraftToFeishu } from "@/lib/factory/create-request";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withRequestLog("factory", async (
  req: NextRequest,
  log,
  ctx: { params: Promise<{ id: string }> }
) => {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const result = await promoteDraftToFeishu(id);
    return NextResponse.json({ ok: true, id, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "draft not found") {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (msg.startsWith("row is not a draft")) {
      return NextResponse.json({ ok: false, error: "not_draft", detail: msg }, { status: 409 });
    }
    log.error("send_to_feishu.failed", err, { quoteId: id });
    return NextResponse.json(
      { ok: false, error: "feishu_append_failed", detail: msg },
      { status: 502 }
    );
  }
});

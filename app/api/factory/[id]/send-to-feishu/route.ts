/**
 * POST /api/factory/[id]/send-to-feishu
 *
 * Promotes a draft factory_quote_requests row (status='draft') to 'pending'
 * by appending it to Feishu and storing the returned feishuRowIndex. Used
 * by the order-summary panel and the history detail modal.
 *
 * Auth: dashboard cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { promoteDraftToFeishu } from "@/lib/factory/create-request";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  return !!cookie && cookie.value === process.env.ADMIN_PASSWORD;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

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
    console.error("[factory/send-to-feishu] failed", err);
    return NextResponse.json(
      { ok: false, error: "feishu_append_failed", detail: msg },
      { status: 502 }
    );
  }
}

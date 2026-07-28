/**
 * POST /api/widget/factory/[id]/send-whatsapp?widget_token=...
 * Sends the finalized PDF to the customer via the WhatsApp bridge.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { sendQuoteWhatsapp } from "@/lib/factory/server/sendWhatsapp";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  // Optional body — the payment schedule picked for THIS send. Absent (or an
  // empty body, which is how every pre-2026-07-28 caller posts) falls back to
  // the operator's configured default.
  const body = await req.json().catch(() => ({}));
  const paymentPlanId =
    typeof body?.paymentPlanId === "string" ? body.paymentPlanId : null;
  const result = await sendQuoteWhatsapp(id, req.headers.get("host"), paymentPlanId);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.message ? { message: result.message } : {}),
        ...(result.detail ? { detail: result.detail } : {}),
      },
      { status: result.status }
    );
  }
  return NextResponse.json(result);
}

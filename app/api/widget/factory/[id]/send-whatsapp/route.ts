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
  const result = await sendQuoteWhatsapp(id, req.headers.get("host"));
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

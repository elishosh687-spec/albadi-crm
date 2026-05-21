/**
 * POST /api/factory/[id]/send-whatsapp
 *
 * Sends the finalized PDF to the customer via the WhatsApp bridge.
 * Auth: dashboard cookie (middleware).
 */

import { NextRequest, NextResponse } from "next/server";
import { sendQuoteWhatsapp } from "@/lib/factory/server/sendWhatsapp";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

/**
 * POST /api/factory/combine/send-whatsapp?ids=a,b,c
 *
 * Sends the merged (combined) PDF to the customer as a real WhatsApp document
 * via the bridge — replaces the old wa.me text-link draft. Stamps
 * sentToCustomerAt on every quote in the set.
 *
 * Auth: dashboard cookie OR widget_token (middleware gates /api/factory/*).
 */

import { NextRequest, NextResponse } from "next/server";
import { sendCombinedQuoteWhatsapp } from "@/lib/factory/server/sendCombinedWhatsapp";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await sendCombinedQuoteWhatsapp(ids, req.headers.get("host"));
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

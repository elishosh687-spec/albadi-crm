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
  const sp = req.nextUrl.searchParams;
  const ids = (sp.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Optional split shipment (air/sea) — mirrors the combined PDF query params.
  const airIds = (sp.get("airIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const airShip = sp.get("airShip");
  const seaShip = sp.get("seaShip");
  const split =
    airIds.length > 0 && airShip && seaShip
      ? { airIds, airShippingOptionId: airShip, seaShippingOptionId: seaShip }
      : undefined;
  // Manual merged-CBM override (grouped orders) — matches the on-screen calc.
  const cbmParam = parseFloat(sp.get("cbm") ?? "");
  const cbmOverride = Number.isFinite(cbmParam) && cbmParam > 0 ? cbmParam : undefined;

  const result = await sendCombinedQuoteWhatsapp(ids, req.headers.get("host"), split, cbmOverride);
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

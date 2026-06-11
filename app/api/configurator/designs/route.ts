import { NextRequest, NextResponse } from "next/server";
import { saveConfiguratorDesign } from "@/lib/configurator/sessions";
import { logLeadEvent } from "@/lib/events/lead-events";

export const runtime = "nodejs";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: corsHeaders() }
    );
  }

  const str = (k: string) => (typeof body[k] === "string" ? String(body[k]) : "");
  const num = (k: string, fallback = 0) => {
    const v = Number(body[k]);
    return Number.isFinite(v) ? v : fallback;
  };
  const bool = (k: string) => body[k] === true || body[k] === "true";

  try {
    const saved = await saveConfiguratorDesign({
      sessionToken: str("sessionToken") || null,
      manychatSubId: str("manychatSubId") || null,
      productId: str("productId") || "p1",
      quantity: Math.max(1, Math.round(num("quantity", 1000))),
      hasHandles: body.hasHandles === undefined ? true : bool("hasHandles"),
      logoColors: Math.min(3, Math.max(1, Math.round(num("logoColors", 1)))),
      hasLamination: bool("hasLamination"),
      shippingOptionId: str("shippingOptionId") || "s1",
      colorSku: str("colorSku"),
      colorHex: str("colorHex"),
      colorName: str("colorName"),
      logoFileName: str("logoFileName") || null,
      logoScale: num("logoScale", 1),
      logoPositionX: num("logoPositionX", 0),
      logoPositionY: num("logoPositionY", 0),
      logoRotation: num("logoRotation", 0),
      unitPriceIls: num("unitPriceIls"),
      totalOrderIls: num("totalOrderIls"),
      customerName: str("customerName"),
      customerEmail: str("customerEmail"),
      customerPhone: str("customerPhone"),
      notes: str("notes") || null,
      source: str("source") === "crm_link" ? "crm_link" : "customer",
    });

    if (saved.manychatSubId) {
      void logLeadEvent({
        manychatSubId: saved.manychatSubId,
        eventType: "configurator_design_saved",
        actor: "customer",
        payload: {
          designId: saved.id,
          productId: str("productId"),
          quantity: num("quantity", 1000),
          totalOrderIls: num("totalOrderIls"),
          colorName: str("colorName"),
        },
      });
    }

    return NextResponse.json(
      { ok: true, id: saved.id, manychatSubId: saved.manychatSubId },
      { headers: corsHeaders() }
    );
  } catch (err) {
    console.error("[configurator/designs] save failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "save_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}

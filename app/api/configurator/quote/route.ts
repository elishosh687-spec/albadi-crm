import { NextRequest, NextResponse } from "next/server";
import {
  buildConfiguratorQuote,
  CONFIGURATOR_PRODUCTS,
  CONFIGURATOR_SHIPPING_OPTIONS,
} from "@/lib/configurator/quote-response";

export const runtime = "nodejs";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  if (sp.get("catalog") === "1") {
    return NextResponse.json(
      {
        ok: true,
        products: CONFIGURATOR_PRODUCTS,
        shippingOptions: CONFIGURATOR_SHIPPING_OPTIONS,
        quantityTiers: [1000, 3000, 5000, 10000],
        logoColorOptions: [1, 2, 3],
      },
      { headers: corsHeaders() }
    );
  }

  const productId = sp.get("productId") ?? "p1";
  const quantity = Math.max(1, parseInt(sp.get("quantity") ?? "1000", 10) || 1000);
  const hasHandles = sp.get("hasHandles") !== "false";
  const logoColors = Math.min(3, Math.max(1, parseInt(sp.get("logoColors") ?? "1", 10) || 1));
  const hasLamination = sp.get("hasLamination") === "true";
  const shippingOptionId = sp.get("shippingOptionId") ?? "s1";

  const quote = await buildConfiguratorQuote({
    productId,
    quantity,
    hasHandles,
    logoColors,
    hasLamination,
    shippingOptionId,
  });

  if (!quote) {
    return NextResponse.json(
      { ok: false, error: "quote_failed" },
      { status: 422, headers: corsHeaders() }
    );
  }

  return NextResponse.json(quote, { headers: corsHeaders() });
}

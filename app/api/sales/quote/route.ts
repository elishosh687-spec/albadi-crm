/**
 * POST /api/sales/quote?token=<WIDGET_SALES_TOKEN>
 *
 * The salesperson's live price. Computes the full quote server-side but returns
 * ONLY customer-facing numbers (SalesCustomerQuote) — cost/profit/margin/
 * commission never cross this boundary. See lib/sales/price.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { salesAuthed } from "@/lib/widget/sales-auth";
import { computeCatalogSales, type SalesCatalogInput } from "@/lib/sales/price";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!salesAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Partial<SalesCatalogInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  if (!body.productId || !body.shippingOptionId) {
    return NextResponse.json({ ok: false, error: "missing productId/shippingOptionId" }, { status: 400 });
  }
  try {
    const out = await computeCatalogSales({
      productId: String(body.productId),
      quantityTierId: body.quantityTierId ?? null,
      quantityOverride: body.quantityOverride ?? null,
      hasHandles: !!body.hasHandles,
      logoColors: Number(body.logoColors) || 1,
      hasLamination: !!body.hasLamination,
      shippingOptionId: String(body.shippingOptionId),
      moldPerColorCny: typeof body.moldPerColorCny === "number" ? body.moldPerColorCny : undefined,
    });
    if (!out) {
      return NextResponse.json({ ok: false, error: "cannot_price" }, { status: 422 });
    }
    // Return ONLY the customer view — never `out.full`.
    return NextResponse.json({ ok: true, quote: out.customer });
  } catch (err) {
    console.error("[sales/quote] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

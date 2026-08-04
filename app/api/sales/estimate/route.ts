/**
 * POST /api/sales/estimate?token=<WIDGET_SALES_TOKEN>
 *
 * Live estimate price (off-catalog dims) for the sales screen. Proxies the exact
 * boss /api/factory/estimate endpoint server-side and returns ONLY the customer
 * view. `refused` when the spec is off-grid (→ salesperson uses the request tab).
 */
import { NextRequest, NextResponse } from "next/server";
import { salesAuthed } from "@/lib/widget/sales-auth";
import { computeEstimateSales, type SalesEstimateInput } from "@/lib/sales/price";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!salesAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Partial<SalesEstimateInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  if (!body.widthCm || !body.heightCm || !body.quantity) {
    return NextResponse.json({ ok: false, error: "missing widthCm/heightCm/quantity" }, { status: 400 });
  }
  try {
    const out = await computeEstimateSales(
      {
        widthCm: Number(body.widthCm),
        heightCm: Number(body.heightCm),
        depthCm: Number(body.depthCm) || 0,
        quantity: Number(body.quantity),
        hasHandles: !!body.hasHandles,
        logoColors: Number(body.logoColors) || 1,
        hasLamination: !!body.hasLamination,
        shippingOptionId: String(body.shippingOptionId || "s2"),
        moldPerColorCny: typeof body.moldPerColorCny === "number" ? body.moldPerColorCny : undefined,
      },
      req.nextUrl.origin
    );
    if (out.refused) {
      return NextResponse.json({ ok: true, refused: true, reason: out.reason ?? null });
    }
    return NextResponse.json({ ok: true, refused: false, quote: out.customer });
  } catch (err) {
    console.error("[sales/estimate] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

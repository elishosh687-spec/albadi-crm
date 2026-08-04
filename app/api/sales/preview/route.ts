/**
 * POST /api/sales/preview?token=<WIDGET_SALES_TOKEN>
 *
 * Returns the EXACT WhatsApp message the customer will receive, so the
 * salesperson can read it before sending (Eli 2026-08-04). Reuses the real
 * buildCaption + payment-terms resolution — no boss data (it's the customer's
 * own message).
 */
import { NextRequest, NextResponse } from "next/server";
import { salesAuthed } from "@/lib/widget/sales-auth";
import { computeCatalogSales, computeEstimateSales, type SalesCatalogInput, type SalesEstimateInput } from "@/lib/sales/price";
import { buildCaption } from "@/lib/factory/server/sendWhatsapp";
import { getFactoryConfig } from "@/lib/factory/config";
import { resolveEffectivePlanId, resolvePaymentPlan, VAT_PCT } from "@/lib/factory/payment-terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body extends Partial<SalesCatalogInput>, Partial<SalesEstimateInput> {
  mode?: "catalog" | "estimate";
  customerName?: string;
  paymentPlanId?: string | null;
}

export async function POST(req: NextRequest) {
  if (!salesAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  try {
    const moldPerColorCny = typeof body.moldPerColorCny === "number" ? body.moldPerColorCny : undefined;
    let full; let spec;
    if (body.mode === "estimate") {
      const est = await computeEstimateSales(
        {
          widthCm: Number(body.widthCm),
          heightCm: Number(body.heightCm),
          depthCm: Number(body.depthCm) || 0,
          quantity: Number(body.quantity),
          hasHandles: !!body.hasHandles,
          logoColors: Number(body.logoColors) || 1,
          hasLamination: !!body.hasLamination,
          shippingOptionId: String(body.shippingOptionId || "s2"),
          moldPerColorCny,
        },
        req.nextUrl.origin
      );
      if (est.refused) return NextResponse.json({ ok: true, refused: true });
      full = est.full; spec = est.spec;
    } else {
      const cat = await computeCatalogSales({
        productId: String(body.productId),
        quantityTierId: body.quantityTierId ?? null,
        quantityOverride: body.quantityOverride ?? null,
        hasHandles: !!body.hasHandles,
        logoColors: Number(body.logoColors) || 1,
        hasLamination: !!body.hasLamination,
        shippingOptionId: String(body.shippingOptionId),
        moldPerColorCny,
      });
      if (!cat) return NextResponse.json({ ok: false, error: "cannot_price" }, { status: 422 });
      full = cat.full; spec = cat.spec;
    }

    const cfg = await getFactoryConfig();
    const planId = resolveEffectivePlanId(body.paymentPlanId, cfg.paymentTerms);
    const text = buildCaption({
      name: body.customerName?.trim() || "",
      spec,
      pricing: full,
      quotationNo: "———",
      plan: planId ? resolvePaymentPlan(planId) : null,
      vatPct: cfg.paymentTerms?.vatPct ?? VAT_PCT,
    });
    return NextResponse.json({ ok: true, text });
  } catch (err) {
    console.error("[sales/preview] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

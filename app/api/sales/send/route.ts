/**
 * POST /api/sales/send?token=<WIDGET_SALES_TOKEN>
 *
 * The salesperson sends a quote to a customer. Server-side it:
 *   1. computes the FULL pricing (stored so the boss sees the full breakdown),
 *   2. creates a factory_quote_request DRAFT under the lead (createdBy='sales'),
 *   3. sends the WhatsApp quote + PDF to the customer (payment terms optional),
 *   4. DMs Eli that a quote went out.
 * The response carries only customer-facing numbers.
 */
import { NextRequest, NextResponse } from "next/server";
import { salesAuthed } from "@/lib/widget/sales-auth";
import { computeCatalogSales, type SalesCatalogInput } from "@/lib/sales/price";
import { computeEstimateSales, type SalesEstimateInput } from "@/lib/sales/price";
import { createFactoryDraft } from "@/lib/factory/create-request";
import { sendQuoteWhatsapp } from "@/lib/factory/server/sendWhatsapp";
import { sendEliDM } from "@/lib/notify/eli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body extends Partial<SalesCatalogInput>, Partial<SalesEstimateInput> {
  mode?: "catalog" | "estimate";
  sid?: string;
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
  const sid = (body.sid ?? "").trim();
  if (!sid) return NextResponse.json({ ok: false, error: "missing_sid" }, { status: 400 });
  const isEstimate = body.mode === "estimate";
  if (isEstimate ? !(body.widthCm && body.heightCm && body.quantity) : !(body.productId && body.shippingOptionId)) {
    return NextResponse.json({ ok: false, error: "missing_spec" }, { status: 400 });
  }

  try {
    const moldPerColorCny = typeof body.moldPerColorCny === "number" ? body.moldPerColorCny : undefined;
    let priced: { full: import("@/lib/factory/types").FactoryPricingResult; spec: import("@/lib/factory/types").FactoryProductSpec; customer: { totalOrderIls: number } } | null;
    if (isEstimate) {
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
      if (est.refused) {
        return NextResponse.json({ ok: false, error: "estimate_refused", reason: est.reason ?? null }, { status: 422 });
      }
      priced = est;
    } else {
      priced = await computeCatalogSales({
        productId: String(body.productId),
        quantityTierId: body.quantityTierId ?? null,
        quantityOverride: body.quantityOverride ?? null,
        hasHandles: !!body.hasHandles,
        logoColors: Number(body.logoColors) || 1,
        hasLamination: !!body.hasLamination,
        shippingOptionId: String(body.shippingOptionId),
        moldPerColorCny,
      });
    }
    if (!priced) return NextResponse.json({ ok: false, error: "cannot_price" }, { status: 422 });

    // 1+2) Store the full pricing as a draft under the lead (boss sees all).
    const draft = await createFactoryDraft({
      manychatSubId: sid,
      productSpec: priced.spec,
      customerName: body.customerName,
      finalPricing: priced.full,
      createdBy: "sales",
    });

    // 3) Send to the customer (reuses payment-terms + PDF + buffer).
    const sent = await sendQuoteWhatsapp(
      draft.id,
      req.headers.get("host"),
      body.paymentPlanId ?? null
    );
    if (!sent.ok) {
      // Draft is saved; surface the send failure so the salesperson can retry.
      return NextResponse.json(
        { ok: false, error: "send_failed", detail: sent.error, quotationNo: draft.quotationNo },
        { status: 502 }
      );
    }

    // 4) Ping Eli (fire-and-forget).
    const name = body.customerName?.trim() || "לקוח";
    void sendEliDM(
      `🧾 איתי שלח הצעה ללקוח\n${name} #${draft.quotationNo}\nסה״כ: ₪${Math.round(
        priced.customer.totalOrderIls
      ).toLocaleString("he-IL")}`
    );

    return NextResponse.json({
      ok: true,
      quotationNo: draft.quotationNo,
      quote: priced.customer,
    });
  } catch (err) {
    console.error("[sales/send] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

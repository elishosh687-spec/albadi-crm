/**
 * POST /api/widget/factory/estimate/send-customer?widget_token=...
 * Widget variant of the preliminary-estimate sender (see the dashboard route).
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { sendEstimateToCustomer } from "@/lib/factory/server/sendEstimateToCustomer";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const sid = typeof b.sid === "string" ? b.sid.trim() : "";
  if (!sid) return NextResponse.json({ ok: false, error: "missing_sid", message: "בחר/י ליד לפני שליחה." }, { status: 400 });
  const num = (v: unknown) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };
  const result = await sendEstimateToCustomer({
    sid,
    spec: {
      heightCm: num(b.heightCm), depthCm: num(b.depthCm), widthCm: num(b.widthCm),
      quantity: Math.max(1, Math.round(num(b.qty))),
      hasHandles: b.handles === true || b.handles === "true",
      hasLamination: b.lamination === true || b.lamination === "true",
      logoColors: Math.max(1, parseInt(String(b.colors ?? "1"), 10) || 1),
    },
    shippingOptionId: typeof b.shipping === "string" ? b.shipping : null,
    // Part-air/part-sea split as configured in the estimator. Without it the
    // server re-prices on the single shipping option and the customer's
    // PDF/caption silently lose the air leg (Eli 2026-07-28).
    split:
      b.split && Number.isFinite(num(b.split.airIls)) && Number.isFinite(num(b.split.seaIls))
        ? {
            airQuantity: Math.max(0, Math.round(num(b.split.airQuantity))),
            seaQuantity: Math.max(0, Math.round(num(b.split.seaQuantity))),
            airIls: num(b.split.airIls),
            seaIls: num(b.split.seaIls),
            airName: String(b.split.airName ?? "אווירי"),
            seaName: String(b.split.seaName ?? "ימי"),
          }
        : null,
    customerName: typeof b.customerName === "string" ? b.customerName : undefined,
    hostHeader: req.headers.get("host"),
    draftId: typeof b.draftId === "string" && b.draftId ? b.draftId : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, ...(result.message ? { message: result.message } : {}) }, { status: result.status });
  }
  return NextResponse.json(result);
}

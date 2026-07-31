/**
 * PUT /api/widget/factory/payments/<id>?widget_token=...
 * Body: { received: { paidIls: number }[] } — how much the customer actually
 * paid per installment (internal tracking). Saved on the deal's primary quote
 * (factory_quote_requests.payments_received). Boss-only, never customer-facing.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { savePaymentsReceived } from "@/lib/factory/server/closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }
  try {
    const body = (await req.json()) as { received?: { paidIls: number }[] };
    await savePaymentsReceived(id, body?.received ?? []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }
}

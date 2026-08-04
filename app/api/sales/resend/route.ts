/**
 * POST /api/sales/resend?token=<WIDGET_SALES_TOKEN>  { id, paymentPlanId? }
 *
 * Re-send an existing SALES quote to its customer. Scoped to createdBy='sales'
 * so a sales token can only re-send sales-made quotes, never arbitrary ones.
 */
import { NextRequest, NextResponse } from "next/server";
import { salesAuthed } from "@/lib/widget/sales-auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { sendQuoteWhatsapp } from "@/lib/factory/server/sendWhatsapp";
import { sendEliDM } from "@/lib/notify/eli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!salesAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string; paymentPlanId?: string | null };
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });

  // Only a sales-created quote can be re-sent through this endpoint.
  const [row] = await db
    .select({ id: factoryQuoteRequests.id, sid: factoryQuoteRequests.manychatSubId, quotationNo: factoryQuoteRequests.quotationNo })
    .from(factoryQuoteRequests)
    .where(and(eq(factoryQuoteRequests.id, id), eq(factoryQuoteRequests.createdBy, "sales")))
    .limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  try {
    const sent = await sendQuoteWhatsapp(id, req.headers.get("host"), body.paymentPlanId ?? null);
    if (!sent.ok) {
      return NextResponse.json({ ok: false, error: "send_failed", detail: sent.error }, { status: 502 });
    }
    const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.manychatSubId, row.sid)).limit(1);
    void sendEliDM(`🔁 איתי שלח שוב הצעה ללקוח\n${lead?.name ?? "לקוח"} #${row.quotationNo}`);
    return NextResponse.json({ ok: true, quotationNo: row.quotationNo });
  } catch (err) {
    console.error("[sales/resend] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

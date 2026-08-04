/**
 * GET /api/sales/history?token=<WIDGET_SALES_TOKEN>
 *
 * The salesperson's own quotes (createdBy='sales'), newest first, so they can
 * re-send. Returns ONLY customer-facing fields — quotation no, customer name,
 * total, sent status/date. No cost/profit/margin/commission.
 */
import { NextRequest, NextResponse } from "next/server";
import { salesAuthed } from "@/lib/widget/sales-auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq, desc } from "drizzle-orm";
import { customerTotalExVat } from "@/lib/factory/customer-total";
import type { FactoryPricingResult } from "@/lib/factory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!salesAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const rows = await db
      .select({
        id: factoryQuoteRequests.id,
        quotationNo: factoryQuoteRequests.quotationNo,
        sid: factoryQuoteRequests.manychatSubId,
        spec: factoryQuoteRequests.productSpec,
        pricing: factoryQuoteRequests.finalPricing,
        sentAt: factoryQuoteRequests.sentToCustomerAt,
        createdAt: factoryQuoteRequests.createdAt,
        name: leads.name,
      })
      .from(factoryQuoteRequests)
      .leftJoin(leads, eq(leads.manychatSubId, factoryQuoteRequests.manychatSubId))
      .where(and(eq(factoryQuoteRequests.createdBy, "sales")))
      .orderBy(desc(factoryQuoteRequests.createdAt))
      .limit(50);

    const quotes = rows.map((r) => {
      const spec = (r.spec ?? {}) as { widthCm?: number; heightCm?: number; depthCm?: number; quantity?: number };
      const dims = [spec.widthCm, spec.depthCm, spec.heightCm].filter((n) => n && n > 0).join("×");
      return {
        id: r.id,
        quotationNo: r.quotationNo,
        customerName: r.name ?? null,
        dimensions: dims,
        quantity: spec.quantity ?? null,
        totalOrderIls: customerTotalExVat(r.pricing as FactoryPricingResult | null),
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      };
    });
    return NextResponse.json({ ok: true, quotes });
  } catch (err) {
    console.error("[sales/history] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

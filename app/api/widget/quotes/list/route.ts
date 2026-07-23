/**
 * GET /api/widget/quotes/list
 * Returns every factory quote request (factory_quote_requests) joined with
 * lead name + GHL link. Status: pending (sent to factory, waiting),
 * received (factory replied), finalized (Eli sent to customer).
 *
 * Auth: widget_token query param.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { desc, isNotNull, isNull, sql } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "200"), 500);
  // ?deleted=1 → the "סל מיחזור" recycle bin (only soft-deleted rows). Default →
  // only live rows (deletedAt IS NULL).
  const deletedOnly = req.nextUrl.searchParams.get("deleted") === "1";
  const deletedFilter = deletedOnly
    ? isNotNull(factoryQuoteRequests.deletedAt)
    : isNull(factoryQuoteRequests.deletedAt);

  const locationId = (process.env.GHL_LOCATION_ID ?? "").replace(/^﻿/, "");
  const ghlBase = `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/`;

  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      leadSid: factoryQuoteRequests.manychatSubId,
      quotationNo: factoryQuoteRequests.quotationNo,
      productSpec: factoryQuoteRequests.productSpec,
      factoryStatus: factoryQuoteRequests.factoryStatus,
      factoryResponse: factoryQuoteRequests.factoryResponse,
      finalPricing: factoryQuoteRequests.finalPricing,
      draftEstimate: factoryQuoteRequests.draftEstimate,
      pdfUrl: factoryQuoteRequests.pdfUrl,
      sentToCustomerAt: factoryQuoteRequests.sentToCustomerAt,
      createdAt: factoryQuoteRequests.createdAt,
      updatedAt: factoryQuoteRequests.updatedAt,
      deletedAt: factoryQuoteRequests.deletedAt,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      ghlContactId: leads.ghlContactId,
    })
    .from(factoryQuoteRequests)
    .leftJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(deletedFilter)
    .orderBy(desc(factoryQuoteRequests.createdAt))
    .limit(limit);

  const out = rows.map((r) => ({
    id: r.id,
    leadSid: r.leadSid,
    name: r.name,
    phone: r.phone,
    stage: r.stage,
    quotationNo: r.quotationNo,
    status: r.factoryStatus,
    productSpec: r.productSpec,
    factoryResponse: r.factoryResponse,
    finalPricing: r.finalPricing,
    draftEstimate: r.draftEstimate,
    pdfUrl: r.pdfUrl,
    sentToCustomerAt: r.sentToCustomerAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    ghlUrl: r.ghlContactId ? `${ghlBase}${r.ghlContactId}` : null,
  }));

  return NextResponse.json({ ok: true, quotes: out, total: out.length });
}

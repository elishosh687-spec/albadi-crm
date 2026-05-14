/**
 * GET /api/factory/list[?status=pending|received|finalized|all][&lead=<sid>]
 *
 * Returns factory_quote_requests rows joined with the lead's display name.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "all";
  const lead = url.searchParams.get("lead")?.trim() ?? "";

  const where = [];
  if (status !== "all") {
    where.push(eq(factoryQuoteRequests.factoryStatus, status));
  }
  if (lead) {
    where.push(sql`trim(${factoryQuoteRequests.manychatSubId}) = ${lead}`);
  }

  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      manychatSubId: factoryQuoteRequests.manychatSubId,
      quotationNo: factoryQuoteRequests.quotationNo,
      createdAt: factoryQuoteRequests.createdAt,
      updatedAt: factoryQuoteRequests.updatedAt,
      productSpec: factoryQuoteRequests.productSpec,
      feishuRowIndex: factoryQuoteRequests.feishuRowIndex,
      factoryStatus: factoryQuoteRequests.factoryStatus,
      factoryResponse: factoryQuoteRequests.factoryResponse,
      finalPricing: factoryQuoteRequests.finalPricing,
      pdfUrl: factoryQuoteRequests.pdfUrl,
      sentToCustomerAt: factoryQuoteRequests.sentToCustomerAt,
      customerName: leads.name,
      customerPhone: leads.phoneE164,
    })
    .from(factoryQuoteRequests)
    .leftJoin(leads, eq(leads.manychatSubId, factoryQuoteRequests.manychatSubId))
    .where(where.length === 1 ? where[0] : where.length > 1 ? and(...where) : undefined)
    .orderBy(desc(factoryQuoteRequests.createdAt))
    .limit(200);

  return NextResponse.json({ ok: true, requests: rows });
}

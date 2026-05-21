/**
 * Shared lister for factory_quote_requests joined with the lead's display.
 * Used by:
 *   - GET /api/factory/list  (dashboard cookie)
 *   - GET /api/widget/factory/list  (widget_token)
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export async function listFactoryQuotes(opts: {
  status?: string;
  lead?: string;
} = {}) {
  const status = opts.status ?? "all";
  const lead = (opts.lead ?? "").trim();

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

  return rows;
}

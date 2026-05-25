/**
 * Clones a factory_quote_requests row to a fresh row at status='received'.
 * Used when Eli wants to edit + resend a finalized quote without overwriting
 * the original. Original row stays untouched in history; the clone gets a new
 * id, new quotationNo, and cleared pdf/finalPricing/sentToCustomerAt so it can
 * go through the finalize modal as if the factory just answered.
 *
 * No Feishu interaction — the spec already came back from the factory once.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface CloneFactoryQuoteResult {
  id: string;
  quotationNo: string;
  sourceId: string;
}

export async function cloneFactoryQuote(
  sourceId: string
): Promise<{ ok: true; result: CloneFactoryQuoteResult } | { ok: false; status: number; error: string }> {
  const [src] = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, sourceId))
    .limit(1);
  if (!src) return { ok: false, status: 404, error: "not_found" };
  if (!src.factoryResponse) {
    return { ok: false, status: 409, error: "no_factory_response" };
  }

  const id = `fq_${Date.now()}_${shortId()}`;
  const quotationNo = id.slice(-8).toUpperCase();

  await db.insert(factoryQuoteRequests).values({
    id,
    manychatSubId: src.manychatSubId,
    quotationNo,
    productSpec: src.productSpec,
    factoryResponse: src.factoryResponse,
    factoryStatus: "received",
    // Fresh clone — no Feishu row, no pdf, not sent yet.
    feishuRowIndex: null,
    finalPricing: null,
    pdfUrl: null,
    sentToCustomerAt: null,
  });

  return { ok: true, result: { id, quotationNo, sourceId } };
}

/**
 * GET /api/factory/[id]/pdf
 *
 * Streams the customer-facing PDF. If `pdfUrl` is set in the DB row, returns
 * a 302 redirect to the Blob URL. Otherwise re-renders on demand from the
 * stored productSpec + finalPricing + lead name.
 *
 * Only available once the request is finalized.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { renderCustomerQuotePdf } from "@/lib/factory/pdf";
import type {
  FactoryProductSpec,
  FactoryPricingResult,
} from "@/lib/factory/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.factoryStatus !== "finalized" || !row.finalPricing) {
    return NextResponse.json(
      { error: "not_finalized", message: "Quote not finalized yet" },
      { status: 409 }
    );
  }

  if (row.pdfUrl) {
    return NextResponse.redirect(row.pdfUrl);
  }

  // Re-render on demand.
  const leadRow = await db
    .select({ name: leads.name })
    .from(leads)
    .where(eq(leads.manychatSubId, row.manychatSubId))
    .limit(1);
  const customerName = leadRow[0]?.name ?? "";

  const buf = await renderCustomerQuotePdf({
    customerName,
    spec: row.productSpec as FactoryProductSpec,
    pricing: row.finalPricing as FactoryPricingResult,
    quotationNo: row.quotationNo ?? id.slice(-8).toUpperCase(),
  });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${row.quotationNo ?? id}.pdf"`,
    },
  });
}

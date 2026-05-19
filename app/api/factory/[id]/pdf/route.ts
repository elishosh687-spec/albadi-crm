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
import { computeQuoteBreakdown } from "@/lib/factory/calculator";
import type {
  FactoryProductSpec,
  FactoryPricingResult,
} from "@/lib/factory/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ?stream=1 proxies the PDF bytes through this endpoint instead of redirecting
  // to the Blob URL. Used by the in-app iframe preview because vercel-storage
  // sets X-Frame-Options that blocks <iframe> embedding of the redirect target.
  const stream = req.nextUrl.searchParams.get("stream") === "1";
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
    if (!stream) return NextResponse.redirect(row.pdfUrl);
    try {
      const upstream = await fetch(row.pdfUrl);
      if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
      const buf = await upstream.arrayBuffer();
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="quote-${row.quotationNo ?? id}.pdf"`,
        },
      });
    } catch (err) {
      console.error("[factory/pdf] stream proxy failed", { id, err });
      // fall through to re-render
    }
  }

  // Re-render on demand.
  try {
    const leadRow = await db
      .select({ name: leads.name })
      .from(leads)
      .where(eq(leads.manychatSubId, row.manychatSubId))
      .limit(1);
    const customerName = leadRow[0]?.name ?? "";

    const spec = row.productSpec as FactoryProductSpec;
    const pricing = row.finalPricing as FactoryPricingResult;

    // Run the local calculator with the spec. Returns null if dims don't
    // match one of the 14 fixed products → PDF falls back to 2-row layout.
    const breakdown = computeQuoteBreakdown({
      widthCm: spec.widthCm,
      heightCm: spec.heightCm,
      depthCm: spec.depthCm,
      quantity: spec.quantity,
      hasHandles: /with handles/i.test(spec.finishing),
      logoColors: parseInt(spec.printing.match(/^(\d+)/)?.[1] ?? "1", 10),
      hasLamination: /(?<!not )laminated/i.test(spec.finishing),
      shippingOptionId: pricing.shippingOptionId,
    });

    const buf = await renderCustomerQuotePdf({
      customerName,
      spec,
      pricing,
      breakdown,
      quotationNo: row.quotationNo ?? id.slice(-8).toUpperCase(),
    });

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="quote-${row.quotationNo ?? id}.pdf"`,
      },
    });
  } catch (err) {
    console.error("[factory/pdf] render failed", { id, err });
    return NextResponse.json(
      {
        error: "pdf_render_failed",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
      },
      { status: 500 }
    );
  }
}

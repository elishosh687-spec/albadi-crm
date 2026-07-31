/**
 * POST /api/widget/zoho/create-invoice?widget_token=...
 * Body: { dealId, advancePercent?, customTerms?, draft?, productName?, description? }
 *
 * Creates the customer invoice in Zoho Books from the deal's finalPricing
 * (Eli's house rules: EX-VAT prices, 18% VAT, bank details, consecutive
 * number, mark Sent unless draft), then:
 *  - uploads the invoice PDF to Blob + attaches it to the deal file
 *  - stamps invoiceSentAt + invoiceZohoId (unless draft)
 *  - records the zohoRef + actualRevenueIls on actualCosts
 *  - mirrors a note to GHL
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { zohoConfigured } from "@/lib/zoho/client";
import { createZohoInvoice, type InvoiceLine } from "@/lib/zoho/write";
import {
  appendDealFile,
  mirrorDealEventToGhl,
  saveDealMilestones,
} from "@/lib/factory/server/milestones";
import { dealMemberIds, saveActualCosts } from "@/lib/factory/server/closed";
import { dealLineName, dealLineDescription } from "@/lib/factory/server/deal-lines";
import { customerTotalExVat } from "@/lib/factory/customer-total";
import type {
  CombinedDealPricing,
  FactoryPricingResult,
  FactoryProductSpec,
  QuoteActualCosts,
} from "@/lib/factory/types";

function lineFromSpec(spec: FactoryProductSpec | null, fp: FactoryPricingResult): InvoiceLine {
  return {
    name: dealLineName(spec),
    description: dealLineDescription(spec),
    quantity: fp.quantity,
    // Bill what the customer was QUOTED (rounded per-bag × qty + molds), not the
    // engine's unrounded total — they differ by a few ₪ and the invoice must
    // reconcile with the PDF/WhatsApp the customer holds (Eli 2026-07-31).
    targetTotalIls: customerTotalExVat(fp) ?? fp.totalSellingPrice,
  };
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!zohoConfigured()) {
    return NextResponse.json({ ok: false, error: "zoho_not_configured" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    dealId?: string;
    advancePercent?: number;
    customTerms?: string;
    draft?: boolean;
    productName?: string;
    description?: string;
  };
  if (!body.dealId) {
    return NextResponse.json({ ok: false, error: "missing dealId" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: factoryQuoteRequests.id,
      quotationNo: factoryQuoteRequests.quotationNo,
      productSpec: factoryQuoteRequests.productSpec,
      finalPricing: factoryQuoteRequests.finalPricing,
      actualCosts: factoryQuoteRequests.actualCosts,
      customerName: leads.name,
    })
    .from(factoryQuoteRequests)
    .leftJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(eq(factoryQuoteRequests.id, body.dealId))
    .limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "deal not found" }, { status: 404 });

  const fp = row.finalPricing as FactoryPricingResult | null;
  const spec = row.productSpec as FactoryProductSpec | null;
  if (!fp || !row.customerName) {
    return NextResponse.json({ ok: false, error: "deal missing pricing or customer name" }, { status: 400 });
  }

  // A combined deal (multiple grouped quotes) → one invoice with a line per
  // product. dealMemberIds returns [primary] for a single-quote deal.
  const memberIds = await dealMemberIds(body.dealId);
  let lineItems: InvoiceLine[];
  if (memberIds.length > 1) {
    const members = await db
      .select({
        id: factoryQuoteRequests.id,
        productSpec: factoryQuoteRequests.productSpec,
        finalPricing: factoryQuoteRequests.finalPricing,
        combinedPricing: factoryQuoteRequests.combinedPricing,
      })
      .from(factoryQuoteRequests)
      .where(inArray(factoryQuoteRequests.id, memberIds));
    // Bill the COMBINED offer that was sent (one merged shipment → each product
    // was quoted cheaper than its standalone quote), not the standalone quotes.
    // The snapshot lives on the primary member; absent → legacy fallback.
    const snap = members
      .map((m) => m.combinedPricing as CombinedDealPricing | null)
      .find((c): c is CombinedDealPricing => !!c?.perProduct?.length);
    const allocated = new Map((snap?.perProduct ?? []).map((p) => [p.id, p.pricing]));
    lineItems = members
      .filter((m) => m.finalPricing)
      .map((m) =>
        lineFromSpec(
          m.productSpec as FactoryProductSpec | null,
          (allocated.get(m.id) ?? m.finalPricing) as FactoryPricingResult
        )
      );
  } else {
    lineItems = [{
      name: body.productName || dealLineName(spec),
      description: body.description ?? dealLineDescription(spec, row.customerName),
      quantity: fp.quantity,
      targetTotalIls: customerTotalExVat(fp) ?? fp.totalSellingPrice,
    }];
  }

  try {
    const result = await createZohoInvoice({
      customerName: row.customerName,
      lineItems,
      advancePercent: body.advancePercent,
      customTerms: body.customTerms,
      draft: body.draft,
    });

    // attach the PDF to the deal file
    let pdfUrl: string | null = null;
    if (result.pdf && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { put } = await import("@vercel/blob");
        const blob = await put(
          `deal-files/${row.id}/invoice-${result.invoiceNumber}.pdf`,
          Buffer.from(result.pdf),
          { access: "public", contentType: "application/pdf", addRandomSuffix: false }
        );
        pdfUrl = blob.url;
        await appendDealFile(row.id, "invoice", {
          url: blob.url,
          name: `חשבונית ${result.invoiceNumber}.pdf`,
          uploadedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn("[zoho/create-invoice] pdf attach failed (non-fatal)", e);
      }
    }

    // stamp the milestone (draft invoices don't count as "issued")
    await saveDealMilestones(row.id, {
      ...(body.draft ? {} : { invoiceSentAt: new Date().toISOString() }),
      invoiceZohoId: result.invoiceNumber,
    });

    // revenue side of the reconciliation + link-back ref
    const ac = (row.actualCosts ?? {}) as QuoteActualCosts;
    await saveActualCosts(row.id, {
      ...ac,
      actualRevenueIls: Math.round(result.subtotal * 100) / 100,
      zohoRefs: [
        ...(ac.zohoRefs ?? []).filter((z) => z.id !== result.invoiceId),
        {
          type: "invoice",
          id: result.invoiceId,
          number: result.invoiceNumber,
          amountIls: result.subtotal,
          date: new Date().toISOString().slice(0, 10),
          party: row.customerName,
        },
      ],
    });

    await mirrorDealEventToGhl(row.id, [
      `🧾 חשבונית ${result.invoiceNumber} נוצרה ב-Zoho (${result.status})`,
      `סה"כ כולל מע"מ: ₪${Math.round(result.total).toLocaleString("he-IL")} · מקדמה: ₪${Math.round(result.advance).toLocaleString("he-IL")}`,
      ...(pdfUrl ? [pdfUrl] : []),
    ]);

    return NextResponse.json({
      ok: true,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      subtotal: result.subtotal,
      taxAmount: result.taxAmount,
      total: result.total,
      advance: result.advance,
      status: result.status,
      pdfUrl,
      tagApplied: result.tagApplied,
    });
  } catch (err) {
    console.error("[zoho/create-invoice] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "invoice_failed" },
      { status: 502 }
    );
  }
}

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
import { eq, sql } from "drizzle-orm";
import { zohoConfigured } from "@/lib/zoho/client";
import { createZohoInvoice } from "@/lib/zoho/write";
import {
  appendDealFile,
  mirrorDealEventToGhl,
  saveDealMilestones,
} from "@/lib/factory/server/milestones";
import { saveActualCosts } from "@/lib/factory/server/closed";
import type { FactoryPricingResult, FactoryProductSpec, QuoteActualCosts } from "@/lib/factory/types";

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

  const sizeLabel = spec
    ? [spec.heightCm && `H${spec.heightCm}`, spec.depthCm && `D${spec.depthCm}`, spec.widthCm && `W${spec.widthCm}`]
        .filter(Boolean)
        .join("*")
    : "";
  // House rule: "שקית אלבד ממותגת — <מידות>", never "נון-וובן".
  const productName = body.productName || `שקית אלבד ממותגת — ${sizeLabel || spec?.productName || ""}`.trim();
  const description =
    body.description ??
    [spec?.material, spec?.printing, spec?.finishing, `לקוח: ${row.customerName}`]
      .filter(Boolean)
      .join(" · ");

  try {
    const result = await createZohoInvoice({
      customerName: row.customerName,
      productName,
      description,
      quantity: fp.quantity,
      targetTotalIls: fp.totalSellingPrice,
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

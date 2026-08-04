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
import { renderCustomerQuotePdf, fetchImageDataUri } from "@/lib/factory/pdf";
import { getFactoryConfig } from "@/lib/factory/config";
import type { StoredDealPlan } from "@/lib/factory/payment-terms";
import { resolveEffectivePlanId } from "@/lib/factory/payment-terms";
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
  // A priced DRAFT renders too — sendQuoteWhatsapp already accepts drafts, and this
  // route is the very URL it hands GreenAPI. Refusing drafts here meant the
  // caption reached the customer while the attachment silently failed: Eli sent
  // Asaf Grinshpan two draft quotes, saw them mirrored in GHL, and there was no
  // PDF in WhatsApp at all (2026-08-02). Same rule as the combined PDF.
  if (!row.finalPricing || (row.factoryStatus !== "finalized" && row.factoryStatus !== "draft")) {
    return NextResponse.json(
      { error: "not_priced", message: "Quote has no price yet" },
      { status: 409 }
    );
  }

  // Resolve the payment plan up front. The stored Blob (row.pdfUrl) was rendered
  // at FINALIZE time — BEFORE any payment plan existed — so it carries NO payment
  // block. Serving it made the customer PDF disagree with the WhatsApp caption
  // (Eli 2026-07-31: "I don't see payment terms in the PDF"). Whenever a plan is
  // resolvable (always, since config carries a default), re-render fresh below so
  // the PDF prints VAT + amount due + installments + bank. Fall back to the stale
  // Blob only when there is genuinely no plan (legacy configs with no default).
  const cfg = await getFactoryConfig();
  const planParam = req.nextUrl.searchParams.get("plan");
  // The settings-resolved plan for this render: the ?plan= choice ("none" → no
  // terms), or the settings default only when include-by-default is on (Eli
  // 2026-08-03 → OFF). null = no payment block.
  const settingsPlanId = resolveEffectivePlanId(planParam, cfg.paymentTerms);
  // What the fresh render actually prints: an explicit send choice wins; an
  // ad-hoc view (no ?plan=) falls back to the DEAL's own stored terms, else the
  // settings-resolved plan. So a closed deal always keeps ITS agreed terms.
  const renderPlan: StoredDealPlan | null = planParam
    ? settingsPlanId
    : ((row.paymentPlan as StoredDealPlan | null) ?? settingsPlanId);

  // Serve the stale finalize Blob only when there is genuinely nothing to render
  // (no plan at all) AND no explicit re-render was requested.
  if (row.pdfUrl && !renderPlan && !planParam) {
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

  // Re-render on demand (fresh — carries the payment terms).
  try {
    const leadRow = await db
      .select({ name: leads.name })
      .from(leads)
      .where(eq(leads.manychatSubId, row.manychatSubId))
      .limit(1);
    const customerName = leadRow[0]?.name ?? "";

    const spec = row.productSpec as FactoryProductSpec;
    const pricing = row.finalPricing as FactoryPricingResult;

    // breakdown=null forces the honest 2-row layout (pricing only). The
    // catalog-derived breakdown ignores factoryResponse.unitCostCny and
    // would display a different total than the WhatsApp text (see lead
    // 972509111981 / quote LHPL3ATC).
    const picDataUri = await fetchImageDataUri(spec.picUrl);
    const buf = await renderCustomerQuotePdf({
      customerName,
      spec,
      pricing,
      breakdown: null,
      customerNotes: spec.customerNotes,
      picDataUri,
      quotationNo: row.quotationNo ?? id.slice(-8).toUpperCase(),
      // renderPlan (above): the send's ?plan= choice ("none" → null → no block),
      // else the deal's own stored terms, else the settings-resolved default.
      paymentPlan: renderPlan,
      vatPct: cfg.paymentTerms?.vatPct,
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

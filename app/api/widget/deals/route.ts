/**
 * GET /api/widget/deals?widget_token=...
 *
 * READ-ONLY, machine-readable view of the closed deals shown in the עסקאות tab —
 * built for external automations (e.g. the Zoho invoice/receipt bot) so they
 * don't have to scrape the UI or re-derive money.
 *
 * Filters (all optional, combinable):
 *   ?sid=<manychat_sub_id>   one customer's deals
 *   ?id=<deal id>            one deal (the primary quote id)
 *   ?q=<text>                case-insensitive match on customer name / phone
 *   ?limit=<1..200>          default 50
 *
 * Why it reuses `listClosedQuotes()`: that function IS the definition of "a
 * closed deal" (explicitly closed, or legacy finalized+WON; combined groups
 * collapsed to one deal priced as the SUM of the already-agreed members). Any
 * separate query here would drift from the screen Eli actually works in.
 *
 * Money contract — matches what the customer received, not a recomputation:
 *   • line_total_ex_vat  = the member's printed customer total (rounded per-bag
 *     × qty + one-time molds, split-aware) — the same figure the PDF/WhatsApp
 *     showed, which is what the payment schedule is computed on.
 *   • subtotal/vat/total + payment_terms come from the deal's STORED plan.
 *     No plan stored → payment_terms is null and vat/total are derived at the
 *     configured VAT rate, so the caller always has a total to invoice.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
import { listClosedQuotes, memberDisplayTotalExVat } from "@/lib/factory/server/closed";
import { dealLineName, dealLineDescription, dealSizeLabel } from "@/lib/factory/server/deal-lines";
import { VAT_PCT } from "@/lib/factory/payment-terms";
import { getFactoryConfig } from "@/lib/factory/config";
import type { FactoryProductSpec } from "@/lib/factory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const sid = (url.searchParams.get("sid") ?? "").trim();
  const id = (url.searchParams.get("id") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));

  const all = await listClosedQuotes();
  const filtered = all
    .filter((d) => (sid ? d.leadSid === sid : true))
    .filter((d) => (id ? d.id === id || d.dealGroupId === id : true))
    .filter((d) =>
      q
        ? (d.customerName ?? "").toLowerCase().includes(q) ||
          (d.customerPhone ?? "").toLowerCase().includes(q)
        : true
    )
    .slice(0, limit);

  // Stage / email / notes per customer — the deal list carries only name+phone,
  // and an invoicing bot needs the email to send the document.
  const sids = [...new Set(filtered.map((d) => d.leadSid).filter(Boolean))];
  const leadBySid = new Map<string, { stage: string | null; email: string | null; notes: string | null }>();
  if (sids.length > 0) {
    const rows = await db
      .select({
        sid: leads.manychatSubId,
        stage: leads.pipelineStage,
        email: leads.email,
        notes: leads.notes,
      })
      .from(leads)
      .where(inArray(leads.manychatSubId, sids));
    for (const r of rows) leadBySid.set(r.sid, { stage: r.stage, email: r.email, notes: r.notes });
  }

  // Absolute base so the returned PDF links are fetchable by an external caller.
  const host = req.headers.get("host") ?? "albadi-crm.vercel.app";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const base = `${proto}://${host}`;

  const cfg = await getFactoryConfig().catch(() => null);
  const vatPct = cfg?.paymentTerms?.vatPct ?? VAT_PCT;

  const deals = filtered.map((d) => {
    const lineItems = d.products
      .filter((p) => p.finalPricing)
      .map((p) => {
        const fp = p.finalPricing!;
        const spec = p.productSpec as FactoryProductSpec;
        const molds = r2(fp.moldsTotalSellingPriceIls ?? 0);
        // Same parse the WhatsApp caption + PDF use, so the automation reads the
        // ordered options without re-implementing the string formats.
        const colors = parseInt(spec?.printing?.match(/(\d+)/)?.[1] ?? "1", 10) || 1;
        const finishing = spec?.finishing ?? "";
        const hasHandles = /with handle/i.test(finishing);
        const hasLamination = /laminat/i.test(finishing) && !/not laminat|non laminat/i.test(finishing);
        return {
          quote_id: p.id,
          quotation_no: p.quotationNo,
          name: dealLineName(spec),
          description: dealLineDescription(spec),
          quantity: fp.quantity,
          unit_price_ex_vat: r2(fp.unitSellingPrice),
          /** Customer-facing printed total for this product (incl. its molds). */
          line_total_ex_vat: r2(memberDisplayTotalExVat(fp)),
          /** One-time tooling charge already INSIDE line_total_ex_vat — split it
           *  onto its own invoice line only if you subtract it from the total. */
          one_time_molds_ex_vat: molds,
          spec: {
            size_label: dealSizeLabel(spec),
            width_cm: spec?.widthCm ?? null,
            depth_cm: spec?.depthCm ?? null,
            height_cm: spec?.heightCm ?? null,
            material: spec?.material ?? null,
            printing: spec?.printing ?? null,
            finishing: spec?.finishing ?? null,
            // Parsed for convenience — the ordered options, same as the quote.
            logo_colors: colors,
            has_handles: hasHandles,
            has_lamination: hasLamination,
            product_name: spec?.productName ?? null,
            customer_notes: spec?.customerNotes ?? null,
            notes: spec?.notes ?? null,
            pic_url: spec?.picUrl ?? null,
          },
          shipping_option: fp.shippingOptionName ?? null,
          is_split_shipment: Boolean(fp.shippingSplit),
          total_cartons: fp.totalCartons ?? null,
          total_cbm: fp.totalCbm ?? null,
          total_weight_kg: fp.totalWeightKg ?? null,
          /** This product's OWN quote PDF. On a combined deal the customer never
           *  received it (it predates the combination) — use the deal-level
           *  customer_pdf_url instead. */
          quote_pdf_url: `${base}/api/factory/${p.id}/pdf?stream=1`,
          sent_to_customer_at: p.sentToCustomerAt,
        };
      });

    // The deal's canonical total — on a combined deal this is the COMBINED
    // offer's grand total (one merged shipment), which is deliberately LESS than
    // the members' standalone quotes add up to.
    const subtotalExVat = r2(
      d.grandTotalExVat ??
        d.paymentSchedule?.subtotal ??
        lineItems.reduce((s, l) => s + l.line_total_ex_vat, 0)
    );
    const vatAmount = d.paymentSchedule ? r2(d.paymentSchedule.vat) : r2(subtotalExVat * (vatPct / 100));
    const totalIncVat = d.paymentSchedule ? r2(d.paymentSchedule.total) : r2(subtotalExVat + vatAmount);

    // The ONE document the customer holds: the combined PDF for a combined deal
    // (rebuilt from the frozen snapshot), else this quote's own PDF.
    const snap = d.combinedPricing;
    let customerPdfUrl: string;
    if (d.isCombined && d.products.length > 1) {
      const qs = new URLSearchParams({ ids: d.products.map((p) => p.id).join(",") });
      if (snap?.cbmOverride && snap.cbmOverride > 0) qs.set("cbm", String(snap.cbmOverride));
      if (snap?.split?.airIds?.length) {
        qs.set("airIds", snap.split.airIds.join(","));
        qs.set("airShip", snap.split.airShippingOptionId);
        qs.set("seaShip", snap.split.seaShippingOptionId);
      }
      customerPdfUrl = `${base}/api/factory/combine/pdf?${qs.toString()}`;
    } else {
      customerPdfUrl = `${base}/api/factory/${d.id}/pdf?stream=1`;
    }

    return {
      deal_id: d.id,
      deal_group_id: d.dealGroupId,
      /** The single customer-facing quote document for this deal. */
      customer_pdf_url: customerPdfUrl,
      quotation_no: d.quotationNo,
      is_combined: d.isCombined,
      /** Closed on a self-estimate, not a factory-confirmed quote. */
      from_estimate: d.fromEstimate,
      explicitly_closed: d.explicitlyClosed,
      sent_to_customer_at: d.sentToCustomerAt,
      updated_at: d.updatedAt,

      customer: {
        sid: d.leadSid,
        name: d.customerName,
        phone: d.customerPhone,
        email: leadBySid.get(d.leadSid)?.email ?? null,
        stage: leadBySid.get(d.leadSid)?.stage ?? null,
        notes: leadBySid.get(d.leadSid)?.notes ?? null,
      },

      line_items: lineItems,

      subtotal_ex_vat: subtotalExVat,
      vat_pct: vatPct,
      vat_amount: vatAmount,
      total_inc_vat: totalIncVat,

      /** Null when the deal has no stored plan — then nothing is owed on a
       *  schedule and the caller should invoice the full total. */
      payment_terms: d.paymentSchedule
        ? {
            plan_id: d.paymentPlanId,
            label: d.paymentPlanLabel,
            /** First installment — the deposit, a share of the VAT-INCLUSIVE total. */
            deposit_amount: d.paymentSchedule.installments[0]?.ils ?? null,
            deposit_pct: d.paymentSchedule.installments[0]?.pct ?? null,
            installments: d.paymentSchedule.installments.map((i) => ({
              pct: i.pct,
              when: i.when,
              amount_inc_vat: i.ils,
            })),
          }
        : null,

      /** Reconciled real costs/revenue, when Eli filled them in. */
      actual_costs: d.actualCosts,
      /** Deal-file stage stamps + uploaded files. */
      milestones: d.dealMilestones,
    };
  });

  return NextResponse.json({
    ok: true,
    count: deals.length,
    total_closed_deals: all.length,
    deals,
  });
}

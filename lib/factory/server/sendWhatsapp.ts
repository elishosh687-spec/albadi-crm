/**
 * Shared send-WhatsApp logic: build caption + send PDF via bridge.
 * Used by:
 *   - POST /api/factory/[id]/send-whatsapp  (dashboard cookie)
 *   - POST /api/widget/factory/[id]/send-whatsapp  (widget_token)
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { phoneToJid } from "@/lib/bridge/jid";
import type {
  FactoryProductSpec,
  FactoryPricingResult,
} from "@/lib/factory/types";
import { customerRoundedTotalIls } from "@/lib/factory/calculator/customer-breakdown";
import { splitCustomerView } from "@/lib/factory/shipping-split";
import { notifyItayQuoteSent } from "@/lib/notify/itay";
import { getFactoryConfig } from "@/lib/factory/config";
import {
  VAT_PCT,
  DEFAULT_PAYMENT_PLAN_ID,
  resolvePaymentPlan,
  computePaymentSchedule,
  buildPaymentBlock,
  type PaymentPlan,
} from "@/lib/factory/payment-terms";

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

/** Exported so a preview/test can render the REAL customer caption instead of
 *  reimplementing the template (which is how the surfaces drifted apart before). */
export function buildCaption(opts: {
  name: string;
  spec: FactoryProductSpec;
  pricing: FactoryPricingResult;
  quotationNo: string;
  /** Payment schedule to quote. Falls back to the 50/50 default. */
  plan?: PaymentPlan;
  vatPct?: number;
}): string {
  const { name, spec, pricing, quotationNo } = opts;
  const plan = opts.plan ?? resolvePaymentPlan(DEFAULT_PAYMENT_PLAN_ID);
  const vatPct = opts.vatPct ?? VAT_PCT;
  const greeting = name ? `היי ${name} 👋` : "היי 👋";
  const dims = [spec.widthCm, spec.depthCm, spec.heightCm]
    .filter((n) => n && n > 0)
    .join("×");
  const qty = spec.quantity.toLocaleString("he-IL");
  // Ordered spec (from printing/finishing) so the quote records exactly what
  // the customer ordered — always shown, not only when it carries a price.
  const colors = spec.printing?.match(/(\d+)/)?.[1] ?? "1";
  const hasHandles = /with handle/i.test(spec.finishing ?? "");
  const hasLam = /laminat/i.test(spec.finishing ?? "") && !/not laminat|non laminat/i.test(spec.finishing ?? "");

  const lines: (string | null)[] = [
    greeting,
    "",
    // Payment-details template (Eli 2026-07-28) — replaced the plain quote
    // header. The quote number stays on its own line for traceability.
    "*פרטי תשלום ופירוט חשבון*",
    `_הצעה #${quotationNo}_`,
    "",
    "📦 *פרטי המוצר*",
    dims ? `מידות: ${dims} ס״מ` : null,
    `כמות: ${qty} יח׳`,
    `צבעי לוגו: ${colors}`,
    `ידיות: ${hasHandles ? "כן" : "ללא"}`,
    `למינציה: ${hasLam ? "כן" : "ללא"}`,
    "",
  ];
  const split = pricing.shippingSplit;
  const moldsIls = pricing.moldsTotalSellingPriceIls ?? 0;
  // The ex-VAT total this message actually PRINTS — the payment block is built
  // from it, never from a recomputed figure, so VAT and the installments can't
  // disagree with the line above them.
  let printedTotalIls: number;
  if (split) {
    // Split shipment: ONE all-in price per bag for each shipping method — no
    // separate production line (Eli 2026-07-28: "עלות פר יחידה למשלוח אווירי,
    // עלות פר יחידה למשלוח ימי — מאוד פשוט").
    const v = splitCustomerView(split, moldsIls);
    lines.push(
      "💰 *תמחור — משלוח מפוצל*",
      `✈️ ${v.air.quantity.toLocaleString("he-IL")} יח׳ · משלוח אווירי × ${formatIls(v.air.unitIls)} = ${formatIls(v.air.totalIls)}`,
      `🚢 ${v.sea.quantity.toLocaleString("he-IL")} יח׳ · משלוח ימי × ${formatIls(v.sea.unitIls)} = ${formatIls(v.sea.totalIls)}`,
    );
    if (v.moldsIls > 0) lines.push(`🧩 תבניות / מולדים (חד פעמי): ${formatIls(v.moldsIls)}`);
    lines.push(`*💵 סה״כ: ${formatIls(v.grandTotalIls)}*`, "_(לא כולל מע״מ)_");
    printedTotalIls = v.grandTotalIls;
  } else {
    lines.push(
      "💰 *תמחור* _(כולל שילוח)_",
      `📦 ${qty} יחידות × ${formatIls(pricing.unitSellingPrice)}`,
    );
    if (pricing.shippingOptionName) {
      lines.push(`🚚 שיטת שילוח: ${pricing.shippingOptionName}`);
    }
    // Total from the rounded per-unit shown above (× qty + molds), so the
    // customer's own "per-unit × qty" reconciles with the total.
    const total = customerRoundedTotalIls(pricing.unitSellingPrice, pricing.quantity, moldsIls);
    lines.push(`*💵 סה״כ: ${formatIls(total)}*`, "_(לא כולל מע״מ)_");
    printedTotalIls = total;
  }
  // VAT → amount due → payment schedule → bank details.
  lines.push(...buildPaymentBlock(computePaymentSchedule(printedTotalIls, plan, vatPct), vatPct));
  return lines.filter((l) => l !== null).join("\n");
}

export interface SendWhatsappOk {
  ok: true;
  wa_message_id: string;
  status: string;
}

export interface SendWhatsappErr {
  ok: false;
  status: number;
  error: string;
  message?: string;
  detail?: string;
}

export async function sendQuoteWhatsapp(
  id: string,
  hostHeader: string | null,
  /** Payment schedule for THIS send — a preset id or `custom_NN`. Omitted →
   *  the operator's configured default (Eli 2026-07-28). */
  paymentPlanId?: string | null
): Promise<SendWhatsappOk | SendWhatsappErr> {
  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, status: 404, error: "not_found" };
  }
  // Accept a finalized factory quote OR a self-calculated DRAFT (both carry
  // finalPricing; the PDF route renders from it either way). A draft estimate is
  // a legit thing to send the customer to keep them warm (Eli 2026-07-22).
  if (!row.finalPricing || (row.factoryStatus !== "finalized" && row.factoryStatus !== "draft")) {
    return { ok: false, status: 409, error: "not_finalized" };
  }
  const isDraft = row.factoryStatus === "draft";
  const host = hostHeader ?? "albadi-crm.vercel.app";
  const proto = host.startsWith("localhost") ? "http" : "https";
  // GreenAPI's sendFileByUrl does NOT follow 3xx redirects — if urlFile
  // returns a redirect it sends the link as plain text instead of attaching
  // the document. The /api/factory/[id]/pdf route 302-redirects to the Blob
  // URL when row.pdfUrl is set, which broke the send into a bare link. So:
  // hand GreenAPI a direct-download URL — the Blob URL itself when present,
  // otherwise the proxy path (?stream=1 returns the bytes with no redirect).
  // Payment schedule for this send — resolved BEFORE the PDF url so the
  // attachment and the caption quote the same figures.
  const cfg = await getFactoryConfig();
  const planId = paymentPlanId ?? cfg.paymentTerms?.defaultPlanId ?? DEFAULT_PAYMENT_PLAN_ID;
  // A stored Blob PDF was rendered at finalize time, BEFORE any payment plan was
  // chosen — so it has no payment block, and reusing it would attach an ex-VAT
  // PDF to a VAT-inclusive caption. Always re-render through the proxy (which
  // returns the bytes directly — GreenAPI doesn't follow redirects) so the PDF
  // carries the same schedule as the message (Eli 2026-07-28).
  const pdfMediaUrl = `${proto}://${host}/api/factory/${id}/pdf?stream=1&plan=${encodeURIComponent(planId)}`;

  const leadRows = await db
    .select({
      name: leads.name,
      waJid: leads.waJid,
      phoneE164: leads.phoneE164,
    })
    .from(leads)
    .where(eq(leads.manychatSubId, row.manychatSubId))
    .limit(1);
  const lead = leadRows[0];
  if (!lead) {
    return { ok: false, status: 404, error: "lead_not_found" };
  }

  const recipient = lead.waJid ?? (lead.phoneE164 ? phoneToJid(lead.phoneE164) : null);
  if (!recipient) {
    return {
      ok: false,
      status: 409,
      error: "no_whatsapp_id",
      message: "Lead has no waJid or phoneE164 — cannot route to WhatsApp.",
    };
  }

  const quotationNo = row.quotationNo ?? id.slice(-8).toUpperCase();
  const caption = buildCaption({
    name: lead.name ?? "",
    spec: row.productSpec as FactoryProductSpec,
    pricing: row.finalPricing as FactoryPricingResult,
    quotationNo,
    plan: resolvePaymentPlan(planId),
    vatPct: cfg.paymentTerms?.vatPct ?? VAT_PCT,
  });
  const pdfFilename = `הצעת-מחיר-${quotationNo}.pdf`;

  let result: { wa_message_id: string; status?: string };
  try {
    result = await sendBridgeMessage(
      recipient,
      caption,
      pdfMediaUrl,
      "eli",
      pdfFilename
    );
  } catch (err) {
    console.error("[factory/send-whatsapp] bridge send failed", err);
    return {
      ok: false,
      status: 502,
      error: "bridge_send_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await db
      .update(factoryQuoteRequests)
      .set({ sentToCustomerAt: new Date(), updatedAt: new Date() })
      .where(eq(factoryQuoteRequests.id, id));
  } catch (err) {
    console.warn("[factory/send-whatsapp] db update failed after bridge send", err);
  }

  // Ping Itay (the salesperson) on every quote sent (Eli 2026-07-22). Non-fatal.
  const sentPricing = row.finalPricing as FactoryPricingResult;
  await notifyItayQuoteSent({
    customerName: lead.name ?? "",
    quotationNo,
    totalIls: sentPricing?.totalSellingPrice ?? null,
    kind: isDraft ? "draft" : "factory",
  });

  return {
    ok: true,
    wa_message_id: result.wa_message_id,
    status: result.status ?? "sent",
  };
}

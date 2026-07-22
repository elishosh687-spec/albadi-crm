/**
 * Send a PRELIMINARY self-quote estimate to the customer over WhatsApp (PDF + caption),
 * clearly marked "אומדן ראשוני" (non-binding, pending factory confirmation). Unlike
 * sendWhatsapp.ts this does NOT need a finalized factory_quote_requests row — it prices
 * the estimate on the fly (estimateFactoryCny → priceFactoryQuote) and sends. The outbound
 * bridge message row is the audit trail (no quote pipeline pollution).
 *
 * Used by POST /api/factory/estimate/send-customer (+ widget variant).
 */
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { phoneToJid } from "@/lib/bridge/jid";
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import { renderCustomerQuotePdf } from "@/lib/factory/pdf";
import { customerRoundedTotalIls } from "@/lib/factory/calculator/customer-breakdown";
import { notifyItayQuoteSent } from "@/lib/notify/itay";
import type { FactoryProductSpec, FactoryPricingResult } from "@/lib/factory/types";

const fmtIls = (n: number) => `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

function buildEstimateCaption(name: string, spec: FactoryProductSpec, pricing: FactoryPricingResult): string {
  const dims = [spec.widthCm, spec.depthCm, spec.heightCm].filter((n) => n && n > 0).join("×");
  const qty = spec.quantity.toLocaleString("he-IL");
  // Ordered spec — always shown so the estimate records exactly what was requested.
  const colors = spec.printing?.match(/(\d+)/)?.[1] ?? "1";
  const hasHandles = /with handle/i.test(spec.finishing ?? "");
  const hasLam = /laminat/i.test(spec.finishing ?? "") && !/not laminat|non laminat/i.test(spec.finishing ?? "");
  const lines: (string | null)[] = [
    name ? `היי ${name} 👋` : "היי 👋",
    "",
    "*אומדן מחיר ראשוני* ✨",
    "",
    "📦 *פרטי המוצר*",
    dims ? `מידות: ${dims} ס״מ` : null,
    `כמות: ${qty} יח׳`,
    `צבעי לוגו: ${colors}`,
    `ידיות: ${hasHandles ? "כן" : "ללא"}`,
    `למינציה: ${hasLam ? "כן" : "ללא"}`,
    "",
    "💰 *אומדן* _(כולל שילוח)_",
    `📦 ${qty} יחידות × ${fmtIls(pricing.unitSellingPrice)}`,
    pricing.shippingOptionName ? `🚚 שיטת שילוח: ${pricing.shippingOptionName}` : null,
    `*💵 סה״כ משוער: ${fmtIls(customerRoundedTotalIls(pricing.unitSellingPrice, pricing.quantity, pricing.moldsTotalSellingPriceIls ?? 0))}*`,
    "_(לא כולל מע״מ)_",
    "",
    "━━━━━━━━━━━━━━",
    "_זהו אומדן ראשוני — המחיר הסופי כפוף לאישור המפעל. נחזור אליך עם הצעה סופית._",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export interface SendEstimateInput {
  sid: string;
  spec: EstimateSpec & { depthCm: number };
  shippingOptionId?: string | null;
  customerName?: string;
  hostHeader?: string | null;
}
export type SendEstimateResult =
  | { ok: true; wa_message_id: string; status: string; unitIls: number; totalIls: number; pdf: boolean }
  | { ok: false; status: number; error: string; message?: string };

export async function sendEstimateToCustomer(input: SendEstimateInput): Promise<SendEstimateResult> {
  const est = await estimateFactoryCny(input.spec);
  if (!est.ok || !est.carton || est.factoryUnitCostCny == null) {
    return { ok: false, status: 422, error: "estimate_refused", message: est.refused ?? "לא ניתן לאמוד — שלח למפעל" };
  }

  const config = await getFactoryConfig({ fresh: true });
  const shippingOptionId = input.shippingOptionId ?? config.shippingOptions.find((s) => s.enabled)?.id ?? null;
  const pricing = priceFactoryQuote(
    {
      factoryUnitCostCny: est.factoryUnitCostCny,
      quantity: input.spec.quantity,
      shippingOptionId,
      cartonSpec: {
        qty: est.carton.qty,
        weightKg: est.carton.weightKg,
        lengthCm: est.carton.lengthCm,
        widthCm: est.carton.widthCm,
        heightCm: est.carton.heightCm,
      },
      moldsCostCny: est.plateFeeOneTimeCny ?? 0,
    },
    config
  );

  const s = input.spec;
  const productSpec: FactoryProductSpec = {
    description: "שקית אל-ארוג 80 גרם",
    material: "80g non-woven",
    widthCm: s.widthCm,
    heightCm: s.heightCm,
    depthCm: s.depthCm,
    quantity: s.quantity,
    printing: `${s.logoColors} color(s)`,
    finishing: `${s.hasHandles ? "With handles" : "No handles"} / ${s.hasLamination ? "Laminated" : "Not laminated"}`,
    shippingOptionId: shippingOptionId ?? undefined,
  };

  const leadRows = await db
    .select({ name: leads.name, waJid: leads.waJid, phoneE164: leads.phoneE164 })
    .from(leads)
    .where(eq(leads.manychatSubId, input.sid))
    .limit(1);
  const lead = leadRows[0];
  if (!lead) return { ok: false, status: 404, error: "lead_not_found" };
  const recipient = lead.waJid ?? (lead.phoneE164 ? phoneToJid(lead.phoneE164) : null);
  if (!recipient) return { ok: false, status: 409, error: "no_whatsapp_id", message: "לליד אין WhatsApp — לא ניתן לשלוח." };

  const customerName = input.customerName ?? lead.name ?? "";
  const caption = buildEstimateCaption(customerName, productSpec, pricing);

  // Render PDF + upload to Blob (estimate has no DB id → timestamped key). GreenAPI needs a
  // direct-download URL; the Blob URL is one. Without a Blob token we send text-only.
  let pdfUrl: string | undefined;
  try {
    const buf = await renderCustomerQuotePdf({ customerName, spec: productSpec, pricing, breakdown: null, isEstimate: true });
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import("@vercel/blob");
      const blob = await put(`factory-estimates/${input.sid}-${Date.now()}.pdf`, buf, {
        access: "public",
        contentType: "application/pdf",
        addRandomSuffix: true,
      });
      pdfUrl = blob.url;
    }
  } catch (err) {
    console.warn("[estimate/send-customer] PDF render/upload failed — sending text only", err);
  }

  let result: { wa_message_id: string; status?: string };
  try {
    result = await sendBridgeMessage(recipient, caption, pdfUrl, "eli", pdfUrl ? "אומדן-ראשוני.pdf" : undefined);
  } catch (err) {
    return { ok: false, status: 502, error: "bridge_send_failed", message: err instanceof Error ? err.message : String(err) };
  }

  // Ping Itay on every quote sent (Eli 2026-07-22). Non-fatal.
  await notifyItayQuoteSent({
    customerName,
    totalIls: pricing.totalSellingPrice,
    kind: "estimate",
  });

  return {
    ok: true,
    wa_message_id: result.wa_message_id,
    status: result.status ?? "sent",
    unitIls: pricing.unitSellingPrice,
    totalIls: pricing.totalSellingPrice,
    pdf: Boolean(pdfUrl),
  };
}

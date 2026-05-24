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

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function buildCaption(opts: {
  name: string;
  spec: FactoryProductSpec;
  pricing: FactoryPricingResult;
  quotationNo: string;
}): string {
  const { name, spec, pricing, quotationNo } = opts;
  const greeting = name ? `היי ${name} 👋` : "היי 👋";
  const dims = [spec.widthCm, spec.depthCm, spec.heightCm]
    .filter((n) => n && n > 0)
    .join("×");
  const qty = spec.quantity.toLocaleString("he-IL");

  const lines: (string | null)[] = [
    greeting,
    "",
    `*הצעת מחיר #${quotationNo}*`,
    "",
    "📦 *פרטי המוצר*",
    dims ? `מידות: ${dims} ס״מ` : null,
    `כמות: ${qty} יח׳`,
    "",
    "💰 *תמחור* _(כולל שילוח)_",
    `📦 ${qty} יחידות × ${formatIls(pricing.unitSellingPrice)}`,
  ];
  if (pricing.shippingOptionName) {
    lines.push(`🚚 שיטת שילוח: ${pricing.shippingOptionName}`);
  }
  lines.push(
    `*💵 סה״כ: ${formatIls(pricing.totalSellingPrice)}*`,
    "_(לא כולל מע״מ)_"
  );
  lines.push(
    "",
    "━━━━━━━━━━━━━━",
    "ההצעה בתוקף ל-14 יום",
    "נשמח לקבל את אישורך 🙂",
    "",
    "_מצאתם מחיר זול יותר? שלחו חשבונית ונבדוק אם נוכל להוזיל._"
  );
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
  hostHeader: string | null
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
  if (row.factoryStatus !== "finalized" || !row.finalPricing) {
    return { ok: false, status: 409, error: "not_finalized" };
  }
  const host = hostHeader ?? "albadi-crm.vercel.app";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const pdfMediaUrl = `${proto}://${host}/api/factory/${id}/pdf`;

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

  return {
    ok: true,
    wa_message_id: result.wa_message_id,
    status: result.status ?? "sent",
  };
}

/**
 * Shared send-WhatsApp logic for a COMBINED quote (multiple finalized quotes
 * merged into one PDF). Mirrors sendWhatsapp.ts but for the N-quote case.
 *
 * Sends the merged PDF as a real document via the bridge (GreenAPI), NOT a
 * wa.me text link. The combined PDF is rendered on demand by
 * GET /api/factory/combine/pdf?ids=… which streams the bytes directly (200,
 * application/pdf, no redirect) so GreenAPI's sendFileByUrl can download it.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { phoneToJid } from "@/lib/bridge/jid";
import { combinedShippingIls } from "@/lib/factory/combined";
import { getFactoryConfig } from "@/lib/factory/config";
import type { FactoryPricingResult } from "@/lib/factory/types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

export interface SendWhatsappOk {
  ok: true;
  wa_message_id: string;
  status: string;
  marked: number;
}

export interface SendWhatsappErr {
  ok: false;
  status: number;
  error: string;
  message?: string;
  detail?: string;
}

/**
 * Grand total of the combined quote, computed identically to the combined PDF:
 * each product's price (ex-shipping) plus the re-allocated single-shipment
 * shipping. Keeps the WhatsApp caption in sync with the PDF the customer opens.
 */
async function combinedGrandTotal(
  pricings: FactoryPricingResult[]
): Promise<number> {
  const config = await getFactoryConfig();
  const combinedCbm = r2(pricings.reduce((s, p) => s + (p.totalCbm || 0), 0));
  const combinedWeight = r2(
    pricings.reduce((s, p) => s + (p.totalWeightKg || 0), 0)
  );
  const shipOpt =
    config.shippingOptions.find((s) => s.id === pricings[0]?.shippingOptionId) ??
    null;
  const combinedShipping = combinedShippingIls(
    combinedCbm,
    combinedWeight,
    shipOpt,
    config.usdToIls
  );
  const productsTotal = pricings.reduce(
    (s, p) => s + r2(p.totalSellingPrice - p.totalShipping),
    0
  );
  return r2(productsTotal + combinedShipping);
}

export async function sendCombinedQuoteWhatsapp(
  ids: string[],
  hostHeader: string | null
): Promise<SendWhatsappOk | SendWhatsappErr> {
  if (ids.length < 1) {
    return { ok: false, status: 400, error: "no_ids" };
  }

  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(inArray(factoryQuoteRequests.id, ids));
  if (rows.length === 0) {
    return { ok: false, status: 404, error: "not_found" };
  }

  // Every selected quote must be finalized…
  const notFinal = rows.find(
    (r) => r.factoryStatus !== "finalized" || !r.finalPricing
  );
  if (notFinal) {
    return {
      ok: false,
      status: 409,
      error: "not_finalized",
      message: `Quote ${notFinal.id} is not finalized`,
    };
  }
  // …and all belong to the same client.
  const sub = rows[0].manychatSubId;
  if (rows.some((r) => r.manychatSubId !== sub)) {
    return {
      ok: false,
      status: 400,
      error: "mixed_clients",
      message: "All quotes must belong to the same client",
    };
  }

  const leadRows = await db
    .select({
      name: leads.name,
      waJid: leads.waJid,
      phoneE164: leads.phoneE164,
    })
    .from(leads)
    .where(eq(leads.manychatSubId, sub))
    .limit(1);
  const lead = leadRows[0];
  if (!lead) {
    return { ok: false, status: 404, error: "lead_not_found" };
  }
  const recipient =
    lead.waJid ?? (lead.phoneE164 ? phoneToJid(lead.phoneE164) : null);
  if (!recipient) {
    return {
      ok: false,
      status: 409,
      error: "no_whatsapp_id",
      message: "Lead has no waJid or phoneE164 — cannot route to WhatsApp.",
    };
  }

  const host = hostHeader ?? "albadi-crm.vercel.app";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const idsParam = ids.join(",");
  const pdfMediaUrl = `${proto}://${host}/api/factory/combine/pdf?ids=${encodeURIComponent(
    idsParam
  )}`;

  const pricings = rows.map((r) => r.finalPricing as FactoryPricingResult);
  const grandTotal = await combinedGrandTotal(pricings);

  const greeting = lead.name ? `היי ${lead.name} 👋` : "היי 👋";
  const title =
    ids.length > 1
      ? `*הצעת מחיר משולבת — ${ids.length} מוצרים*`
      : "*הצעת מחיר*";
  const caption = [
    greeting,
    "",
    title,
    "",
    `*💵 סה״כ: ${formatIls(grandTotal)}*`,
    "_(כולל שילוח, לא כולל מע״מ)_",
    "",
    "━━━━━━━━━━━━━━",
    "ההצעה בתוקף ל-14 יום",
    "נשמח לקבל את אישורך 🙂",
  ].join("\n");

  const pdfFilename = `הצעת-מחיר-משולבת-${ids.length}-מוצרים.pdf`;

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
    console.error("[factory/combine/send-whatsapp] bridge send failed", err);
    return {
      ok: false,
      status: 502,
      error: "bridge_send_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Stamp every quote as sent so the card shows "נשלח ✓".
  try {
    const now = new Date();
    await db
      .update(factoryQuoteRequests)
      .set({ sentToCustomerAt: now, updatedAt: now })
      .where(inArray(factoryQuoteRequests.id, ids));
  } catch (err) {
    console.warn(
      "[factory/combine/send-whatsapp] db update failed after bridge send",
      err
    );
  }

  return {
    ok: true,
    wa_message_id: result.wa_message_id,
    status: result.status ?? "sent",
    marked: ids.length,
  };
}

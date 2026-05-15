/**
 * POST /api/factory/[id]/send-whatsapp
 *
 * Sends the finalized PDF to the customer via the WhatsApp bridge, with a
 * short Hebrew caption summarizing the offer. The outbound row is logged in
 * `messages` with sender='eli' so it appears in ChatThread naturally.
 *
 * Requires `lead.waJid` (or phone) to be populated.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { phoneToJid } from "@/lib/bridge/jid";
import type {
  FactoryProductSpec,
  FactoryPricingResult,
} from "@/lib/factory/types";

export const runtime = "nodejs";
export const maxDuration = 30;

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
  const product = spec.description?.trim() || "שקיות";
  const qty = spec.quantity.toLocaleString("he-IL");

  const lines: (string | null)[] = [
    greeting,
    "",
    `*הצעת מחיר #${quotationNo}*`,
    "",
    "📦 *פרטי המוצר*",
    product,
    dims ? `מידות: ${dims} ס״מ` : null,
    `כמות: ${qty} יח׳`,
    "",
    "💰 *תמחור*",
    `מחיר ליחידה: ${formatIls(pricing.unitSellingPrice)}`,
    `*סה״כ: ${formatIls(pricing.totalSellingPrice)}*`,
    "_(לא כולל מע״מ)_",
  ];
  if (pricing.shippingOptionName) {
    lines.push("", "🚚 *שילוח*", pricing.shippingOptionName);
  }
  lines.push(
    "",
    "━━━━━━━━━━━━━━",
    "ההצעה בתוקף ל-14 יום",
    "נשמח לקבל את אישורך 🙂"
  );
  return lines.filter((l) => l !== null).join("\n");
}

export async function POST(
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
      { error: "not_finalized" },
      { status: 409 }
    );
  }
  // Always use the on-demand render endpoint as the PDF URL — it's public
  // (middleware exempts GET /api/factory/<id>/pdf) and avoids Blob access
  // issues on the bridge side.
  const host = _req.headers.get("host") ?? "albadi-crm.vercel.app";
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
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  const recipient = lead.waJid ?? (lead.phoneE164 ? phoneToJid(lead.phoneE164) : null);
  if (!recipient) {
    return NextResponse.json(
      {
        error: "no_whatsapp_id",
        message: "Lead has no waJid or phoneE164 — cannot route to WhatsApp.",
      },
      { status: 409 }
    );
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
    return NextResponse.json(
      {
        error: "bridge_send_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  try {
    await db
      .update(factoryQuoteRequests)
      .set({ sentToCustomerAt: new Date(), updatedAt: new Date() })
      .where(eq(factoryQuoteRequests.id, id));
  } catch (err) {
    // Bridge already sent — log and return success so UI doesn't show an error
    console.warn("[factory/send-whatsapp] db update failed after bridge send", err);
  }

  return NextResponse.json({
    ok: true,
    wa_message_id: result.wa_message_id,
    status: result.status ?? "sent",
  });
}

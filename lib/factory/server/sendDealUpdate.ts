/**
 * "שלח עדכון ללקוח" — WhatsApp the customer the amounts added to a deal after
 * the original quote went out (a repeat order, an extra service).
 *
 * The original quote PDF is a historical document — it stays as sent. What the
 * customer needs now is the delta and the new bottom line, so this message
 * states the additions, the updated total, and the payment schedule recomputed
 * on that total (via the deal's stored plan). Bank details come from the same
 * payment-terms module the quotes and the Zoho invoice use, so the three can
 * never quote different numbers.
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { listClosedQuotes } from "@/lib/factory/server/closed";
import { buildPaymentBlock, BANK_DETAILS, VAT_PCT } from "@/lib/factory/payment-terms";

export interface DealUpdateResult {
  ok: boolean;
  error?: string;
  preview?: string;
  sent?: boolean;
}

const fmt = (n: number) =>
  `₪${Math.round(n).toLocaleString("he-IL")}`;

/** Build the message. Exported so the UI can preview before anything is sent. */
export function buildDealUpdateMessage(deal: {
  customerName: string | null;
  dealAddons: { label: string; amountIls: number }[];
  grandTotalExVat: number;
  productsTotalExVat: number;
  paymentSchedule: Parameters<typeof buildPaymentBlock>[0] | null;
}): string {
  const lines: string[] = ["*עדכון להזמנה*"];
  if (deal.customerName) lines.push(deal.customerName);
  lines.push("");
  lines.push("*תוספות שסוכמו:*");
  for (const a of deal.dealAddons) {
    lines.push(`• ${a.label} — ${fmt(a.amountIls)}`);
  }
  lines.push("");
  lines.push(`הזמנה מקורית: ${fmt(deal.productsTotalExVat)}`);
  lines.push(`*סה״כ מעודכן (ללא מע״מ): ${fmt(deal.grandTotalExVat)}*`);
  lines.push("");
  if (deal.paymentSchedule) {
    lines.push(...buildPaymentBlock(deal.paymentSchedule, VAT_PCT));
  } else {
    // No stored plan — still show what's owed including VAT so the customer
    // isn't left computing it.
    const vat = deal.grandTotalExVat * (VAT_PCT / 100);
    lines.push(`*מע״מ ${VAT_PCT}%: ${fmt(vat)}*`);
    lines.push(`💵 *סה״כ לתשלום: ${fmt(deal.grandTotalExVat + vat)}*`);
    lines.push("");
    lines.push(BANK_DETAILS);
  }
  return lines.join("\n");
}

export async function sendDealUpdate(
  dealId: string,
  opts: { dryRun?: boolean } = {},
): Promise<DealUpdateResult> {
  const deals = await listClosedQuotes();
  const deal = deals.find((d) => d.id === dealId);
  if (!deal) return { ok: false, error: "deal_not_found" };
  if (!deal.dealAddons?.length) {
    return { ok: false, error: "no_addons_to_report" };
  }

  const text = buildDealUpdateMessage({
    customerName: deal.customerName,
    dealAddons: deal.dealAddons,
    grandTotalExVat: deal.grandTotalExVat,
    productsTotalExVat: deal.productsTotalExVat,
    paymentSchedule: deal.paymentSchedule,
  });
  if (opts.dryRun) return { ok: true, preview: text, sent: false };

  const sid = (deal.leadSid ?? "").trim();
  if (!sid) return { ok: false, error: "lead_has_no_sid", preview: text };

  try {
    // sender 'eli' — this is a manual, human-initiated message, and that
    // attribution is what pauses the bot on this lead.
    await sendBridgeMessage(sid, text, undefined, "eli");
  } catch (e) {
    return {
      ok: false,
      error: `send_failed: ${e instanceof Error ? e.message : e}`,
      preview: text,
    };
  }

  // Stamp so the card can show the customer has been told.
  await db
    .update(factoryQuoteRequests)
    .set({ updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, dealId));
  await db
    .update(leads)
    .set({ updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`);

  return { ok: true, sent: true, preview: text };
}

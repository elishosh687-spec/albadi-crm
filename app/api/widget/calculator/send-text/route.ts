/**
 * POST /api/widget/calculator/send-text
 *
 * Sends a free-form quote text to a lead from inside the calculator widget.
 * Used when Eli computes a manual quote on a phone call and wants to drop
 * it straight into the customer's WhatsApp thread without going through the
 * full factory pipeline / PDF.
 *
 * Auth: widget_token query param (validated by middleware on /api/widget/*).
 * Body: { sid: string; text: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { phoneToJid } from "@/lib/bridge/jid";
import { notifyItayQuoteSent } from "@/lib/notify/itay";

export const runtime = "nodejs";
export const maxDuration = 30;

const NOTIFY_KINDS = new Set(["draft", "factory", "estimate", "combined"]);

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: {
    sid?: string; text?: string;
    customerName?: string; kind?: string; totalIls?: number | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const sid = (body.sid ?? "").trim();
  const text = (body.text ?? "").trim();
  if (!sid) {
    return NextResponse.json({ ok: false, error: "missing_sid" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: "missing_text" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ ok: false, error: "text_too_long" }, { status: 413 });
  }

  const [lead] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      waJid: leads.waJid,
      phoneE164: leads.phoneE164,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);
  if (!lead) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  const recipient =
    lead.waJid ?? (lead.phoneE164 ? phoneToJid(lead.phoneE164) : null);
  if (!recipient) {
    return NextResponse.json(
      { ok: false, error: "no_whatsapp_id" },
      { status: 409 }
    );
  }

  try {
    const result = await sendBridgeMessage(recipient, text, undefined, "eli");
    // Every quote sent to a customer pings Itay (Eli's rule 2026-07-26).
    // Fire-and-forget; never blocks or fails the send.
    const kind = (NOTIFY_KINDS.has(body.kind ?? "") ? body.kind : "estimate") as
      "draft" | "factory" | "estimate" | "combined";
    void notifyItayQuoteSent({
      customerName: body.customerName?.trim() || lead.name,
      totalIls: typeof body.totalIls === "number" ? body.totalIls : null,
      kind,
    });
    return NextResponse.json({
      ok: true,
      wa_message_id: result.wa_message_id,
      status: result.status ?? "sent",
    });
  } catch (err) {
    console.error("[widget/calculator/send-text] bridge send failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "bridge_send_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}

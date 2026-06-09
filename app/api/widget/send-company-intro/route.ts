/**
 * POST /api/widget/send-company-intro
 *
 * Sends the "company intro" template to a lead from inside a GHL-embedded
 * widget (inbox / calculator). Same message the bot sends after the quote in
 * the questionnaire: company video + the 3 sister-site buttons + Instagram.
 *
 * Auth: widget_token query param (same as the other /api/widget/* routes).
 * Body: { sid: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { sendCompanyTemplate } from "@/lib/bridge/client";
import { phoneToJid } from "@/lib/bridge/jid";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { sid?: string };
  try {
    body = (await req.json()) as { sid?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const sid = (body.sid ?? "").trim();
  if (!sid) {
    return NextResponse.json({ ok: false, error: "missing_sid" }, { status: 400 });
  }

  const [lead] = await db
    .select({
      sid: leads.manychatSubId,
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
    return NextResponse.json({ ok: false, error: "no_whatsapp_id" }, { status: 409 });
  }

  try {
    await sendCompanyTemplate(recipient);
    return NextResponse.json({ ok: true, status: "sent" });
  } catch (err) {
    console.error("[widget/send-company-intro] send failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "send_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}

/**
 * GET /api/widget/quotes/list
 * Returns every quote ever sent (bot_quotes) joined with lead name + GHL link.
 * Auth: widget_token query param.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botQuotes, leads } from "@/drizzle/schema";
import { desc, sql } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "200"), 500);
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  const locationId = (process.env.GHL_LOCATION_ID ?? "").replace(/^﻿/, "");
  const ghlBase = `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/`;

  const rows = await db
    .select({
      id: botQuotes.id,
      leadSid: botQuotes.leadSid,
      source: botQuotes.source,
      quoteText: botQuotes.quoteText,
      quoteTotalIls: botQuotes.quoteTotalIls,
      quoteAltTotalIls: botQuotes.quoteAltTotalIls,
      qState: botQuotes.qState,
      sentAt: botQuotes.sentAt,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      ghlContactId: leads.ghlContactId,
    })
    .from(botQuotes)
    .leftJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${botQuotes.leadSid})`)
    .orderBy(desc(botQuotes.sentAt))
    .limit(limit);

  const filtered = q
    ? rows.filter((r) =>
        (r.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
        (r.phone ?? "").includes(q) ||
        r.leadSid.toLowerCase().includes(q.toLowerCase())
      )
    : rows;

  const out = filtered.map((r) => ({
    id: r.id,
    leadSid: r.leadSid,
    name: r.name,
    phone: r.phone,
    stage: r.stage,
    source: r.source,
    quoteTotalIls: r.quoteTotalIls,
    quoteAltTotalIls: r.quoteAltTotalIls,
    qState: r.qState,
    quoteText: r.quoteText,
    sentAt: r.sentAt.toISOString(),
    ghlUrl: r.ghlContactId ? `${ghlBase}${r.ghlContactId}` : null,
  }));

  return NextResponse.json({ ok: true, quotes: out, total: out.length });
}

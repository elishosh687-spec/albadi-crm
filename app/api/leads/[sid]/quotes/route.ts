/**
 * GET /api/leads/[sid]/quotes
 *
 * Returns the bot-side quote history for a lead — every WhatsApp quote the
 * bot sent (initial + auto-requote), most recent first. Source of truth for
 * the OrderSummary "Quote history" accordion.
 *
 * Auth: dashboard cookie (albadi_auth == ADMIN_PASSWORD), same as the other
 * /api/leads/[sid] surfaces.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botQuotes } from "@/drizzle/schema";
import { desc, sql } from "drizzle-orm";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  return !!cookie && cookie.value === process.env.ADMIN_PASSWORD;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sid: raw } = await params;
  const sid = decodeURIComponent(raw).trim();
  if (!sid) {
    return NextResponse.json({ error: "missing_sid" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: botQuotes.id,
      source: botQuotes.source,
      qState: botQuotes.qState,
      quoteText: botQuotes.quoteText,
      quoteTotalIls: botQuotes.quoteTotalIls,
      quoteAltTotalIls: botQuotes.quoteAltTotalIls,
      sentAt: botQuotes.sentAt,
    })
    .from(botQuotes)
    .where(sql`trim(${botQuotes.leadSid}) = ${sid}`)
    .orderBy(desc(botQuotes.sentAt))
    .limit(50);

  return NextResponse.json({ ok: true, quotes: rows });
}

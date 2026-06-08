/**
 * GET /api/admin/audit-ghl-gap
 *
 * "לידים שנופלים בין הכיסאות" — active leads with WhatsApp activity (msgs /
 * jid / phone) but `ghl_contact_id IS NULL`. They got picked up by the bot
 * / re-engagement campaign but never made it into the GHL CRM, so Eli
 * can't see them there.
 *
 * Auth: Bearer BOT_SECRET.
 *
 * Optional query params:
 *   ?limit=N            cap result list (1..500, default 100)
 *   ?onlyBotTouched=1   restrict to leads the bot has already sent to
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);
  const onlyBotTouched = url.searchParams.get("onlyBotTouched") === "1";

  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      jid: leads.waJid,
      stage: leads.pipelineStage,
      botPaused: leads.botPaused,
      source: leads.source,
      createdAt: leads.createdAt,
      lastResponseAt: leads.lastResponseAt,
      msgCount: sql<number>`(select count(*)::int from ${messages} m where m.manychat_sub_id = ${leads.manychatSubId})`,
      lastInboundAt: sql<Date | null>`(select max(m.received_at) from ${messages} m where m.manychat_sub_id = ${leads.manychatSubId} and m.direction = 'in')`,
      lastOutboundAt: sql<Date | null>`(select max(m.received_at) from ${messages} m where m.manychat_sub_id = ${leads.manychatSubId} and m.direction = 'out')`,
    })
    .from(leads)
    .where(and(isNull(leads.ghlContactId), eq(leads.active, true)))
    .orderBy(desc(leads.createdAt));

  const withActivity = rows.filter((l) => (l.msgCount ?? 0) > 0 || l.jid || l.phone);
  const botTouched = withActivity.filter((l) => l.lastOutboundAt);
  const shown = (onlyBotTouched ? botTouched : withActivity).slice(0, limit);

  return NextResponse.json({
    summary: {
      activeWithoutGhl: rows.length,
      withWhatsAppActivity: withActivity.length,
      botAlreadyMessaged: botTouched.length,
      returned: shown.length,
    },
    leads: shown,
  });
}

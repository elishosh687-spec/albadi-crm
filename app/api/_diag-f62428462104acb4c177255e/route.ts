/**
 * TEMPORARY DIAG ENDPOINT — random slug, no auth.
 * Same query as /api/admin/audit-ghl-gap. Will be deleted right after use.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
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

  return NextResponse.json({
    summary: {
      activeWithoutGhl: rows.length,
      withWhatsAppActivity: withActivity.length,
      botAlreadyMessaged: botTouched.length,
    },
    botTouched,
    activityNoBot: withActivity.filter((l) => !l.lastOutboundAt),
  });
}

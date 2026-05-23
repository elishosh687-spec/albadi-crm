/**
 * GET /api/bot/preview
 * Returns what the bot will do in the next 36h.
 * Auth: widget_token query param (same as other widget APIs).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, botDrafts, factoryQuoteRequests } from "@/drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export const runtime = "nodejs";

const HOUR_MS = 60 * 60 * 1000;
const MAX_FOLLOWUPS = 3;
const CADENCE: Record<string, number[]> = {
  PRE_QUOTE: [1, 1, 1],
  INITIAL_QUOTE_SENT: [2, 12, 23],
  AWAITING_FIRST_RESPONSE: [2, 12, 23],
  SHOWED_INTEREST: [2, 12, 23],
  FACTORY_CHECK: [2, 12, 23],
  FINAL_QUOTE_SENT: [2, 12, 23],
  NEGOTIATING: [2, 12, 23],
};

function jerusalemHour(d: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }).formatToParts(d);
  return Number(p.find(x => x.type === "hour")?.value ?? 0);
}
function nextSendAt(lastFollowUpAt: Date | null, cadenceHours: number, base: Date): Date {
  const anchor = lastFollowUpAt ?? base;
  const candidate = new Date(anchor.getTime() + cadenceHours * HOUR_MS);
  for (let i = 0; i < 50; i++) {
    const h = jerusalemHour(candidate);
    if (h >= 9 && h < 21) return candidate;
    candidate.setHours(candidate.getHours() + 1);
  }
  return candidate;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  // Also accept bearer for sanity.
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
  if (!verifyWidgetToken(token) && !verifyWidgetToken(bearer)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const locationId = (process.env.GHL_LOCATION_ID ?? "").replace(/^﻿/, "");
  const ghlBase = `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/`;

  const now = new Date();
  const active = await db.select().from(leads).where(and(eq(leads.active, true), eq(leads.botPaused, false)));

  const upcoming: Array<{ sid: string; name: string | null; stage: string; attempt: number; sendAt: string; ghlContactId: string | null; ghlUrl: string | null }> = [];
  for (const l of active) {
    if (l.followUpCount >= MAX_FOLLOWUPS) continue;
    const stageKey = l.pipelineStage ?? "PRE_QUOTE";
    const cad = CADENCE[stageKey];
    if (!cad) continue;
    const hours = cad[Math.min(l.followUpCount, cad.length - 1)];
    const sendAt = nextSendAt(l.lastFollowUpAt, hours, now);
    if (sendAt.getTime() - now.getTime() > 36 * HOUR_MS) continue;
    upcoming.push({
      sid: l.manychatSubId,
      name: l.name,
      stage: stageKey,
      attempt: l.followUpCount + 1,
      sendAt: sendAt.toISOString(),
      ghlContactId: l.ghlContactId,
      ghlUrl: l.ghlContactId ? `${ghlBase}${l.ghlContactId}` : null,
    });
  }
  upcoming.sort((a, b) => a.sendAt.localeCompare(b.sendAt));

  const drafts = await db.select().from(botDrafts).where(eq(botDrafts.status, "pending"));
  const draftRows = await Promise.all(
    drafts.map(async (d) => {
      const [l] = await db.select({ name: leads.name, ghlContactId: leads.ghlContactId }).from(leads).where(eq(leads.manychatSubId, d.manychatSubId)).limit(1);
      return {
        id: d.id,
        sid: d.manychatSubId,
        name: l?.name ?? null,
        moneyReason: d.moneyReason,
        draftText: d.draftText,
        ghlUrl: l?.ghlContactId ? `${ghlBase}${l.ghlContactId}` : null,
      };
    })
  );

  const factory = await db
    .select()
    .from(factoryQuoteRequests)
    .where(sql`${factoryQuoteRequests.factoryStatus} != 'finalized'`);
  const factoryRows = await Promise.all(
    factory.map(async (f) => {
      const [l] = await db.select({ name: leads.name, ghlContactId: leads.ghlContactId }).from(leads).where(eq(leads.manychatSubId, f.manychatSubId)).limit(1);
      return {
        id: f.id,
        sid: f.manychatSubId,
        name: l?.name ?? null,
        status: f.factoryStatus,
        ghlUrl: l?.ghlContactId ? `${ghlBase}${l.ghlContactId}` : null,
      };
    })
  );

  const paused = await db.select({ sid: leads.manychatSubId, name: leads.name, stage: leads.pipelineStage, ghlContactId: leads.ghlContactId }).from(leads).where(eq(leads.botPaused, true));
  const pausedRows = paused.map(p => ({ ...p, ghlUrl: p.ghlContactId ? `${ghlBase}${p.ghlContactId}` : null }));

  return NextResponse.json({
    now: now.toISOString(),
    upcoming,
    drafts: draftRows,
    factory: factoryRows,
    paused: pausedRows,
  });
}

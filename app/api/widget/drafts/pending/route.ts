/**
 * GET /api/widget/drafts/pending?widget_token=...
 *
 * Returns up to 100 pending bot_drafts with the lead + last inbound snapshot
 * each row needs to render in the approval queue. Same shape as the page
 * server component used by /dashboard/v3/drafts.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botDrafts, leads, messages } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { widgetAuthed } from "@/lib/widget/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface DraftWidgetRow {
  id: number;
  manychatSubId: string;
  draftText: string;
  moneyReason: string | null;
  pipelineStageAtGen: string | null;
  generatedAt: string;
  leadName: string | null;
  leadPhone: string | null;
  leadStage: string | null;
  leadFlag: string | null;
  leadBotSummary: string | null;
  leadBotPaused: boolean;
  lastInboundText: string | null;
  lastInboundAt: string | null;
}

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const drafts = await db
    .select()
    .from(botDrafts)
    .where(eq(botDrafts.status, "pending"))
    .orderBy(desc(botDrafts.generatedAt))
    .limit(100);

  let rows: DraftWidgetRow[] = [];
  if (drafts.length > 0) {
    const subIds = Array.from(new Set(drafts.map((d) => d.manychatSubId.trim())));

    const [leadRows, lastInbound] = await Promise.all([
      Promise.all(
        subIds.map((sid) =>
          db
            .select({
              sid: leads.manychatSubId,
              name: leads.name,
              phone: leads.phoneE164,
              stage: leads.pipelineStage,
              flag: leads.pipelineFlag,
              botSummary: leads.botSummary,
              botPaused: leads.botPaused,
            })
            .from(leads)
            .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
            .limit(1)
            .then((r) => r[0] ?? null)
        )
      ),
      Promise.all(
        subIds.map((sid) =>
          db
            .select({ text: messages.text, receivedAt: messages.receivedAt })
            .from(messages)
            .where(
              and(
                sql`trim(${messages.manychatSubId}) = ${sid}`,
                eq(messages.direction, "in")
              )
            )
            .orderBy(desc(messages.receivedAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        )
      ),
    ]);

    const leadBySid = new Map<string, (typeof leadRows)[number]>();
    leadRows.forEach((row, i) => leadBySid.set(subIds[i], row));
    const inboundBySid = new Map<string, (typeof lastInbound)[number]>();
    lastInbound.forEach((row, i) => inboundBySid.set(subIds[i], row));

    rows = drafts.map((d) => {
      const sid = d.manychatSubId.trim();
      const lead = leadBySid.get(sid) ?? null;
      const inbound = inboundBySid.get(sid) ?? null;
      return {
        id: d.id,
        manychatSubId: d.manychatSubId,
        draftText: d.draftText,
        moneyReason: d.moneyReason,
        pipelineStageAtGen: d.pipelineStageAtGen,
        generatedAt: d.generatedAt.toISOString(),
        leadName: lead?.name ?? null,
        leadPhone: lead?.phone ?? null,
        leadStage: lead?.stage ?? null,
        leadFlag: lead?.flag ?? null,
        leadBotSummary: lead?.botSummary ?? null,
        leadBotPaused: lead?.botPaused ?? false,
        lastInboundText: inbound?.text ?? null,
        lastInboundAt: inbound?.receivedAt?.toISOString() ?? null,
      };
    });
  }

  return NextResponse.json({ ok: true, count: rows.length, drafts: rows });
}

/**
 * GET /api/drafts/pending
 *
 * Returns the Approval Queue feed for the Retool supervisor console.
 * Each row joins draft + lead summary + the most recent inbound message so
 * the UI can render a self-contained card without follow-up requests.
 *
 * Auth: Bearer BOT_SECRET.
 *
 * Optional query params:
 *   ?limit=N         cap result size (1..500, default 50)
 *   ?lead=<sub_id>   filter to a single lead
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botDrafts, leads, messages } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 10;

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
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 500);
  const leadFilter = url.searchParams.get("lead")?.trim() ?? "";

  const drafts = leadFilter
    ? await db
        .select()
        .from(botDrafts)
        .where(
          and(
            eq(botDrafts.status, "pending"),
            sql`trim(${botDrafts.manychatSubId}) = ${leadFilter}`
          )
        )
        .orderBy(desc(botDrafts.generatedAt))
        .limit(limit)
    : await db
        .select()
        .from(botDrafts)
        .where(eq(botDrafts.status, "pending"))
        .orderBy(desc(botDrafts.generatedAt))
        .limit(limit);

  if (drafts.length === 0) {
    return NextResponse.json({ ok: true, drafts: [] });
  }

  // Enrich with lead snapshot + last inbound message text in a couple of
  // small follow-up queries. Drafts queue is typically <50 rows so per-row
  // lookup is acceptable; if it grows we can join in SQL later.
  const subIds = Array.from(new Set(drafts.map((d) => d.manychatSubId.trim())));

  const leadRows = await Promise.all(
    subIds.map((sid) =>
      db
        .select({
          sid: leads.manychatSubId,
          name: leads.name,
          phone: leads.phoneE164,
          jid: leads.waJid,
          pipelineStage: leads.pipelineStage,
          pipelineFlag: leads.pipelineFlag,
          botSummary: leads.botSummary,
          notes: leads.notes,
          quoteTotal: leads.quoteTotal,
          botPaused: leads.botPaused,
          updatedAt: leads.updatedAt,
        })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
        .limit(1)
        .then((r) => r[0] ?? null)
    )
  );
  const leadBySid = new Map<string, (typeof leadRows)[number]>();
  leadRows.forEach((row, i) => leadBySid.set(subIds[i], row));

  // Last inbound text per lead (best-effort).
  const lastInbound = await Promise.all(
    subIds.map((sid) =>
      db
        .select({
          text: messages.text,
          receivedAt: messages.receivedAt,
        })
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
  );
  const inboundBySid = new Map<string, (typeof lastInbound)[number]>();
  lastInbound.forEach((row, i) => inboundBySid.set(subIds[i], row));

  const enriched = drafts.map((d) => {
    const sid = d.manychatSubId.trim();
    const lead = leadBySid.get(sid) ?? null;
    const inbound = inboundBySid.get(sid) ?? null;
    return {
      id: d.id,
      manychat_sub_id: d.manychatSubId,
      draft_text: d.draftText,
      edited_text: d.editedText,
      status: d.status,
      money_reason: d.moneyReason,
      llm_confidence: d.llmConfidence,
      pipeline_stage_at_gen: d.pipelineStageAtGen,
      generated_at: d.generatedAt,
      trigger_message_id: d.triggerMessageId,
      lead,
      last_inbound: inbound,
    };
  });

  return NextResponse.json({ ok: true, drafts: enriched });
}

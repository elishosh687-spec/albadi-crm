/**
 * Pull the next batch of pending analysis_queue items, each enriched with
 * full lead context (ManyChat fields, tags, last_input_text, message history,
 * previous suggestion, recent eli decisions).
 *
 * Called by the local Claude Code skill `albadi-classify` via /loop 1h.
 *
 * Marks each returned row as `status='analyzing'` so concurrent skills
 * don't double-analyze.
 *
 * Auth: Bearer BOT_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  analysisQueue,
  messages,
  pipelineSuggestions,
  eliDecisions,
} from "@/drizzle/schema";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { getSubscriber } from "@/lib/manychat/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 20;
const STUCK_ANALYZING_MINUTES = 5;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Recover rows stuck in 'analyzing' (skill crashed before POSTing back).
  const stuckCutoff = new Date(
    Date.now() - STUCK_ANALYZING_MINUTES * 60 * 1000
  );
  await db
    .update(analysisQueue)
    .set({ status: "pending", startedAt: null })
    .where(
      and(
        eq(analysisQueue.status, "analyzing"),
        lt(analysisQueue.startedAt, stuckCutoff)
      )
    );

  // Atomic claim: SELECT pending IDs and UPDATE to analyzing in one go.
  const pending = await db
    .select({ id: analysisQueue.id, sid: analysisQueue.manychatSubId, reason: analysisQueue.reason })
    .from(analysisQueue)
    .where(eq(analysisQueue.status, "pending"))
    .orderBy(analysisQueue.queuedAt)
    .limit(BATCH_LIMIT);

  if (pending.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const claimedIds = pending.map((r) => r.id);
  await db
    .update(analysisQueue)
    .set({ status: "analyzing", startedAt: new Date() })
    .where(inArray(analysisQueue.id, claimedIds));

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const items = [] as any[];
  for (const row of pending) {
    let manychatData: any = null;
    try {
      const sub = await getSubscriber(row.sid.trim());
      manychatData = {
        name: sub.name ?? null,
        phone: sub.phone ?? null,
        tags: sub.tags.map((t) => ({ id: t.id, name: t.name })),
        custom_fields: sub.custom_fields.map((f) => ({
          id: f.id,
          name: f.name,
          value: f.value,
        })),
        last_input_text: (sub as any).last_input_text ?? null,
        last_interaction: (sub as any).last_interaction ?? null,
        last_seen: (sub as any).last_seen ?? null,
        subscribed: (sub as any).subscribed ?? null,
      };
    } catch (e: any) {
      manychatData = { error: e.message };
    }

    const msgRows = await db
      .select({
        direction: messages.direction,
        text: messages.text,
        receivedAt: messages.receivedAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.manychatSubId, row.sid),
          gte(messages.receivedAt, sixtyDaysAgo)
        )
      )
      .orderBy(messages.receivedAt);

    const [prevSugg] = await db
      .select({
        id: pipelineSuggestions.id,
        suggestedStage: pipelineSuggestions.suggestedStage,
        suggestedFlags: pipelineSuggestions.suggestedFlags,
        suggestedNextAction: pipelineSuggestions.suggestedNextAction,
        suggestedSummary: pipelineSuggestions.suggestedSummary,
        reason: pipelineSuggestions.reason,
        status: pipelineSuggestions.status,
        approvedStage: pipelineSuggestions.approvedStage,
        approvedFlags: pipelineSuggestions.approvedFlags,
        overrideReason: pipelineSuggestions.overrideReason,
        createdAt: pipelineSuggestions.createdAt,
      })
      .from(pipelineSuggestions)
      .where(eq(pipelineSuggestions.manychatSubId, row.sid))
      .orderBy(desc(pipelineSuggestions.createdAt))
      .limit(1);

    const decisionRows = await db
      .select({
        action: eliDecisions.action,
        claudeSuggested: eliDecisions.claudeSuggested,
        eliChose: eliDecisions.eliChose,
        overrideReason: eliDecisions.overrideReason,
        decidedAt: eliDecisions.decidedAt,
      })
      .from(eliDecisions)
      .where(eq(eliDecisions.manychatSubId, row.sid))
      .orderBy(desc(eliDecisions.decidedAt))
      .limit(5);

    items.push({
      queueId: row.id,
      subscriberId: row.sid,
      reason: row.reason,
      manychat: manychatData,
      messages: msgRows,
      previousSuggestion: prevSugg ?? null,
      recentEliDecisions: decisionRows,
    });
  }

  return NextResponse.json({ items });
}

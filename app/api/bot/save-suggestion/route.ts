/**
 * Receives Claude's analysis output for a queued lead, writes a fresh
 * pipeline_suggestions row (status=pending_review), and marks the queue
 * row as 'analyzed'.
 *
 * Auth: Bearer BOT_SECRET.
 *
 * Body:
 *   {
 *     queueId:       number,
 *     subscriberId:  string,
 *     stage:         V2PipelineStage,
 *     flags:         V2FlagName[],
 *     next_action:   string | null,
 *     bot_summary:   string | null,
 *     reason:        string,
 *     prev_stage?:   string | null
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analysisQueue, pipelineSuggestions } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import {
  V2_FLAG_NAMES,
  V2_PIPELINE_STAGES,
  type V2FlagName,
  type V2PipelineStage,
} from "@/lib/manychat/config";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const queueId = Number(body?.queueId);
  const subscriberId = String(body?.subscriberId ?? "").trim();
  const stage = body?.stage as V2PipelineStage;
  const flags: V2FlagName[] = Array.isArray(body?.flags) ? body.flags : [];
  const nextAction = body?.next_action ? String(body.next_action) : null;
  const botSummary = body?.bot_summary ? String(body.bot_summary) : null;
  const reason = String(body?.reason ?? "").trim();
  const prevStage = body?.prev_stage ? String(body.prev_stage) : null;

  if (!Number.isFinite(queueId) || queueId <= 0) {
    return NextResponse.json({ error: "queueId required" }, { status: 400 });
  }
  if (!subscriberId) {
    return NextResponse.json({ error: "subscriberId required" }, { status: 400 });
  }
  if (!V2_PIPELINE_STAGES.includes(stage)) {
    return NextResponse.json({ error: `invalid stage: ${stage}` }, { status: 400 });
  }
  for (const f of flags) {
    if (!V2_FLAG_NAMES.includes(f)) {
      return NextResponse.json({ error: `invalid flag: ${f}` }, { status: 400 });
    }
  }
  if (!reason) {
    return NextResponse.json({ error: "reason required" }, { status: 400 });
  }

  // Supersede any older pending_review suggestion for the same sub_id.
  await db
    .update(pipelineSuggestions)
    .set({ status: "superseded" })
    .where(
      and(
        eq(pipelineSuggestions.manychatSubId, subscriberId),
        eq(pipelineSuggestions.status, "pending_review")
      )
    );

  const [row] = await db
    .insert(pipelineSuggestions)
    .values({
      manychatSubId: subscriberId,
      prevStage,
      suggestedStage: stage,
      suggestedFlags: flags,
      suggestedNextAction: nextAction,
      suggestedSummary: botSummary,
      reason,
      source: "claude",
      status: "pending_review",
    })
    .returning({ id: pipelineSuggestions.id });

  await db
    .update(analysisQueue)
    .set({ status: "analyzed", finishedAt: new Date() })
    .where(eq(analysisQueue.id, queueId));

  return NextResponse.json({ ok: true, suggestionId: row.id });
}

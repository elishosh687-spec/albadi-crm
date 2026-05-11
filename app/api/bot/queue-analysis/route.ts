/**
 * Queue builder — finds leads that need a fresh Claude analysis and inserts
 * rows into `analysis_queue`. Local Claude /albadi-classify picks them up.
 *
 * Trigger: invoked at the start of /albadi-classify (Bearer BOT_SECRET).
 *
 * Logic per active lead:
 *   - never has a pipeline_suggestions row → reason 'never_analyzed'
 *   - has a message in `messages` newer than its most-recent suggestion → 'new_message'
 *   - else skip — time alone does NOT re-queue a lead. Notes edits made
 *     through the dashboard enqueue themselves (reason 'notes_updated')
 *     via app/actions/v2.ts updateLeadNotes.
 *
 * Skips if a 'pending' or 'analyzing' row already exists in analysis_queue
 * for that sub_id (to avoid duplicates).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analysisQueue, leads, messages, pipelineSuggestions } from "@/drizzle/schema";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

type QueueReason = "never_analyzed" | "new_message";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const activeLeads = await db
    .select({ id: leads.manychatSubId })
    .from(leads)
    .where(eq(leads.active, true));
  const subscriberIds = activeLeads.map((r) => r.id.trim()).filter(Boolean);
  const uniqueIds = Array.from(new Set(subscriberIds));

  // Skip ones already in queue (pending or analyzing).
  const queuedRows =
    uniqueIds.length === 0
      ? []
      : await db
          .select({ id: analysisQueue.manychatSubId })
          .from(analysisQueue)
          .where(
            and(
              inArray(analysisQueue.manychatSubId, uniqueIds),
              inArray(analysisQueue.status, ["pending", "analyzing"])
            )
          );
  const alreadyQueued = new Set(queuedRows.map((r) => r.id));

  let queued = 0;
  let skipped = 0;
  const queuedDetails: { sid: string; reason: QueueReason }[] = [];

  for (const sid of uniqueIds) {
    if (alreadyQueued.has(sid)) {
      skipped++;
      continue;
    }

    const [latestSugg] = await db
      .select({ createdAt: pipelineSuggestions.createdAt })
      .from(pipelineSuggestions)
      .where(eq(pipelineSuggestions.manychatSubId, sid))
      .orderBy(desc(pipelineSuggestions.createdAt))
      .limit(1);

    let reason: QueueReason | null = null;

    if (!latestSugg) {
      reason = "never_analyzed";
    } else {
      const [newerMsg] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.manychatSubId, sid),
            gt(messages.receivedAt, latestSugg.createdAt)
          )
        )
        .limit(1);
      if (newerMsg) {
        reason = "new_message";
      }
    }

    if (!reason) {
      skipped++;
      continue;
    }

    await db.insert(analysisQueue).values({ manychatSubId: sid, reason });
    queued++;
    queuedDetails.push({ sid, reason });
  }

  return NextResponse.json({
    ok: true,
    activeLeads: uniqueIds.length,
    queued,
    skipped,
    details: queuedDetails,
  });
}

// Allow GET for sanity check (auth still required, returns same logic)
export async function GET(req: NextRequest) {
  return POST(req);
}

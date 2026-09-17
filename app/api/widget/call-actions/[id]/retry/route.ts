import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { callActionCandidates } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { executeCallActionCandidate } from "@/lib/calls/task-executor";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";

export const POST = withRequestLog(
  "widget",
  async (req: NextRequest, log, ctx: { params: Promise<{ id: string }> }) => {
    if (!widgetAuthed(req)) {
      log.warn("unauthorized");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const candidateId = Number(id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      return NextResponse.json({ ok: false, error: "invalid candidate id" }, { status: 400 });
    }
    const [candidate] = await db
      .select()
      .from(callActionCandidates)
      .where(eq(callActionCandidates.id, candidateId))
      .limit(1);
    if (!candidate || candidate.status !== "failed") {
      return NextResponse.json({ ok: false, error: "only failed candidates can retry" }, { status: 409 });
    }
    await db
      .update(callActionCandidates)
      .set({ status: "approved", executionStatus: "pending", updatedAt: new Date() })
      .where(eq(callActionCandidates.id, candidateId));
    const execution = await executeCallActionCandidate(candidateId);
    log.info("call_action.retried", { candidateId, executed: execution.executed, reason: execution.reason });
    return NextResponse.json({ ok: execution.executed, execution }, { status: execution.executed ? 200 : 409 });
  },
);

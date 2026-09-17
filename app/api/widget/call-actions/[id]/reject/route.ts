import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { callActionCandidates } from "@/drizzle/schema";
import { db } from "@/lib/db";
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
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      return NextResponse.json({ ok: false, error: "invalid candidate id" }, { status: 400 });
    }
    const [rejected] = await db
      .update(callActionCandidates)
      .set({
        status: "rejected",
        executionStatus: "not_requested",
        decidedBy: "eli",
        humanDecisionReason: body.reason?.trim() || null,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(callActionCandidates.id, candidateId),
          inArray(callActionCandidates.status, ["pending", "failed"]),
        ),
      )
      .returning({ id: callActionCandidates.id });
    if (!rejected) {
      return NextResponse.json({ ok: false, error: "candidate is no longer pending" }, { status: 409 });
    }
    log.info("call_action.rejected", { candidateId, hasReason: Boolean(body.reason?.trim()) });
    return NextResponse.json({ ok: true });
  },
);

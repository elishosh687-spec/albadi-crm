/**
 * Returns escalations awaiting Claude analysis, joined with their decision context.
 * Called by the Cloud Routine on a poll cycle.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { escalations, decisions } from "@/drizzle/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: escalations.id,
      manychatSubId: escalations.manychatSubId,
      leadName: escalations.leadName,
      reason: escalations.reason,
      triggerText: escalations.triggerText,
      createdAt: escalations.createdAt,
      decisionContext: decisions.inputMessages,
      ruleMatched: decisions.ruleMatched,
      aiConfidence: decisions.aiConfidence,
      prevTag: decisions.prevTag,
    })
    .from(escalations)
    .leftJoin(decisions, eq(escalations.decisionId, decisions.id))
    .where(and(eq(escalations.analyzeRequested, true), isNull(escalations.analyzedAt)))
    .orderBy(desc(escalations.createdAt))
    .limit(20);

  return NextResponse.json({ pending: rows });
}

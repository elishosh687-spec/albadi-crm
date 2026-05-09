/**
 * Marks all open, unanalyzed escalations as pending analysis.
 * Bulk version of /api/bot/analyze-escalation. Called from a Server Action.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { escalations } from "@/drizzle/schema";
import { and, isNull, eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await db
    .update(escalations)
    .set({ analyzeRequested: true })
    .where(
      and(
        isNull(escalations.resolvedAt),
        isNull(escalations.analyzedAt),
        eq(escalations.analyzeRequested, false)
      )
    )
    .returning({ id: escalations.id });

  return NextResponse.json({ ok: true, marked: result.length });
}

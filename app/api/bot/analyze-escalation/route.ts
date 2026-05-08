/**
 * Marks an escalation as pending analysis. Cloud Routine picks it up.
 * Called from a Server Action (BOT_SECRET available server-side).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { escalations } from "@/drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { id?: number };
  const id = body.id;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  await db
    .update(escalations)
    .set({ analyzeRequested: true })
    .where(and(eq(escalations.id, id), isNull(escalations.analyzedAt)));

  return NextResponse.json({ ok: true });
}

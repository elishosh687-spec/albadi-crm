import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { escalations } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { id: number; action: "resolve" | "dismiss"; note?: string };
  const { id, action, note } = body;

  if (!id || !action) {
    return NextResponse.json({ error: "missing id or action" }, { status: 400 });
  }

  await db
    .update(escalations)
    .set({
      resolvedAt: new Date(),
      resolutionNote: note ?? action,
    })
    .where(eq(escalations.id, id));

  return NextResponse.json({ ok: true });
}

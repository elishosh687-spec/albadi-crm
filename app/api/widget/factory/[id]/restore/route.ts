/**
 * POST /api/widget/factory/[id]/restore?widget_token=...
 *
 * Brings a soft-deleted quote back from the "סל מיחזור" recycle bin by clearing
 * its deletedAt tombstone (Eli 2026-07-23). Lets a mistakenly-deleted draft
 * return without the salesperson resubmitting.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const restored = await db
    .update(factoryQuoteRequests)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id))
    .returning({ id: factoryQuoteRequests.id });
  if (restored.length === 0) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}

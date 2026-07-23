/**
 * DELETE /api/widget/factory/[id]?widget_token=...
 * Soft-deletes a factory_quote_requests row → the "סל מיחזור" recycle bin
 * (restorable, Feishu row not touched). `?hard=1` removes it permanently.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { widgetAuthed } from "@/lib/widget/auth";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const hard = req.nextUrl.searchParams.get("hard") === "1";
  if (hard) {
    const deleted = await db
      .delete(factoryQuoteRequests)
      .where(eq(factoryQuoteRequests.id, id))
      .returning({ id: factoryQuoteRequests.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, hard: true });
  }
  const deleted = await db
    .update(factoryQuoteRequests)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(factoryQuoteRequests.id, id), isNull(factoryQuoteRequests.deletedAt)))
    .returning({ id: factoryQuoteRequests.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

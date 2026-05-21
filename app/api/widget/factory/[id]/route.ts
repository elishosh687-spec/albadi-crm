/**
 * DELETE /api/widget/factory/[id]?widget_token=...
 * Removes a factory_quote_requests row (Feishu row not touched).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
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
  const deleted = await db
    .delete(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .returning({ id: factoryQuoteRequests.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

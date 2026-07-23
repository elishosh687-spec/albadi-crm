/**
 * DELETE /api/factory/[id]
 *
 * Removes a factory_quote_requests row from the DB. The corresponding Feishu
 * row is NOT touched (we'd need a safe delete-by-row-index, which risks
 * collisions with concurrent factory edits; out of scope for now). Use this
 * to clean test data or remove obsolete history.
 *
 * Auth: dashboard cookie (albadi_auth == ADMIN_PASSWORD) OR widget_token
 * query param matching GHL_WIDGET_TOKEN (so the Quotes History widget inside
 * the GHL iframe can delete rows). Middleware also gates this path.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";

export const runtime = "nodejs";

const BOM = "﻿";
function stripBom(s: string | undefined): string | undefined {
  if (typeof s !== "string") return s;
  return s.startsWith(BOM) ? s.slice(1) : s;
}

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  if (cookie && cookie.value === process.env.ADMIN_PASSWORD) return true;
  const widgetToken = req.nextUrl.searchParams.get("widget_token");
  const expected = stripBom(process.env.GHL_WIDGET_TOKEN);
  if (expected && widgetToken === expected) return true;
  return false;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  // Default = soft-delete (move to recycle bin, restorable). `?hard=1` permanently
  // removes the row — only used by the recycle-bin "delete forever" button.
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

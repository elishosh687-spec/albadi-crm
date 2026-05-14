/**
 * DELETE /api/factory/[id]
 *
 * Removes a factory_quote_requests row from the DB. The corresponding Feishu
 * row is NOT touched (we'd need a safe delete-by-row-index, which risks
 * collisions with concurrent factory edits; out of scope for now). Use this
 * to clean test data or remove obsolete history.
 *
 * Auth: dashboard cookie (albadi_auth == ADMIN_PASSWORD), same pattern as
 * /api/leads/[sid]/factory-draft.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  return !!cookie && cookie.value === process.env.ADMIN_PASSWORD;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const deleted = await db
    .delete(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .returning({ id: factoryQuoteRequests.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/factory/combine/mark-sent?ids=a,b,c
 *
 * Stamp sentToCustomerAt on the given finalized quotes — called when the user
 * opens the combined WhatsApp draft, so the customer card can show "נשלח ✓".
 * Auth: dashboard cookie OR widget_token (middleware gates /api/factory/*).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: "no_ids" }, { status: 400 });
  }
  const now = new Date();
  await db
    .update(factoryQuoteRequests)
    .set({ sentToCustomerAt: now, updatedAt: now })
    .where(inArray(factoryQuoteRequests.id, ids));
  return NextResponse.json({ ok: true, marked: ids.length });
}

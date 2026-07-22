/**
 * POST /api/widget/factory/[id]/mark-sent?widget_token=...
 * Body: { sent?: boolean }  (default true)
 *
 * Marks a quote as sent-to-customer WITHOUT sending anything — for drafts the
 * salesperson already sent the customer by hand (Eli 2026-07-22). Stamps
 * (or clears) sentToCustomerAt so the row drops off the "טרם נשלחו" panel.
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
  const body = await req.json().catch(() => ({}));
  const sent = body?.sent === false ? false : true;

  const rows = await db
    .select({ id: factoryQuoteRequests.id })
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  await db
    .update(factoryQuoteRequests)
    .set({ sentToCustomerAt: sent ? new Date() : null, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));

  return NextResponse.json({ ok: true, id, sent });
}

/**
 * POST /api/widget/factory/[id]/dismiss-reminder?widget_token=...
 * Body: { dismissed?: boolean }  (default true)
 *
 * Removes a quote from the "המפעל ענה — צריך לשלוח ללקוח" reminder panel WITHOUT
 * deleting it or stamping sentToCustomerAt — for a dead lead Eli will never
 * price/send. Persistent (a DB column) so it doesn't resurface next load.
 * dismissed:false clears it (un-dismiss). Per Eli 2026-07-26.
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
  const dismissed = body?.dismissed === false ? false : true;

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
    .set({ reminderDismissedAt: dismissed ? new Date() : null, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));

  return NextResponse.json({ ok: true, id, dismissed });
}

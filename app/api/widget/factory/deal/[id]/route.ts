/**
 * GET /api/widget/factory/deal/<id>?widget_token=...
 *
 * Single deal's data for the local mockup/dieline bridge (scripts/deal-file.ts):
 * customer + phone + product spec + current milestones/files. Read-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const [row] = await db
    .select({
      id: factoryQuoteRequests.id,
      quotationNo: factoryQuoteRequests.quotationNo,
      productSpec: factoryQuoteRequests.productSpec,
      dealMilestones: factoryQuoteRequests.dealMilestones,
      customerName: leads.name,
      customerPhone: leads.phoneE164,
    })
    .from(factoryQuoteRequests)
    .leftJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, deal: row });
}

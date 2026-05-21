/**
 * GET /api/widget/leads/[sid]/factory-context?widget_token=...
 *
 * Returns the per-lead snapshot the factory-flow widget needs to render:
 *   - lead row (name, phone, stage, qState, factorySpecDraft)
 *   - list of factory_quote_requests for the lead
 *
 * Read-only; one round trip per contact selection.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { widgetAuthed } from "@/lib/widget/auth";
import { listFactoryQuotes } from "@/lib/factory/server/list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sid: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { sid } = await ctx.params;
  const [lead] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      qState: leads.qState,
      factorySpecDraft: leads.factorySpecDraft,
      quoteTotal: leads.quoteTotal,
      followUpDate: leads.followUpDate,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);

  if (!lead) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  const requests = await listFactoryQuotes({ lead: sid });

  return NextResponse.json({ ok: true, lead, requests });
}

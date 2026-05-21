/**
 * GHL widget → Albadi lead lookup.
 *
 * Called by `app/widget/calculator/page.tsx` to resolve a GHL contactId
 * (passed in via `{{contact.id}}` from the Custom Menu Link URL) back to
 * the Albadi `leads` row + `q_state`.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Response:
 *   { ok: true, lead: { sid, name, phone, stage, qState, quoteTotal, ... } }
 *   { ok: false, error: "..." }    on auth / not-found
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token");
  if (!verifyWidgetToken(token)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const contactId = req.nextUrl.searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json(
      { ok: false, error: "missing contactId" },
      { status: 400 }
    );
  }

  const [row] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      waJid: leads.waJid,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      nextAction: leads.nextAction,
      botSummary: leads.botSummary,
      notes: leads.notes,
      quoteTotal: leads.quoteTotal,
      quoteAlt: leads.quoteAlt,
      qState: leads.qState,
      factorySpecDraft: leads.factorySpecDraft,
      followUpCount: leads.followUpCount,
      botPaused: leads.botPaused,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.ghlContactId, contactId))
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "lead not found for ghl_contact_id=" + contactId },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, lead: row });
}

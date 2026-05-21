/**
 * POST /api/widget/drafts/[id]/approve?widget_token=...
 * Body: { edited_text?: string }
 *
 * Sends the draft via the WhatsApp bridge, marks the draft as sent, attaches
 * Eli's verdict ("approved_as_is" or "edited_draft") to the most recent
 * bot_decision_log row for the lead.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { approveDraft } from "@/lib/drafts";
import { db } from "@/lib/db";
import { botDrafts } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { logLeadEvent } from "@/lib/events/lead-events";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const draftId = parseInt(id, 10);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid draft id" }, { status: 400 });
  }

  let editedText: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { edited_text?: string };
    editedText = body.edited_text;
  } catch {
    editedText = undefined;
  }

  const r = await approveDraft(draftId, editedText);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }

  // Mirror the dashboard server action's event logging side-effect.
  try {
    const [d] = await db
      .select({ sid: botDrafts.manychatSubId })
      .from(botDrafts)
      .where(eq(botDrafts.id, draftId))
      .limit(1);
    if (d?.sid) {
      void logLeadEvent({
        manychatSubId: d.sid,
        eventType: "draft_approved",
        payload: { draftId, edited: !!editedText, via: "widget" },
      });
    }
  } catch {}

  return NextResponse.json({ ok: true, message: "נשלח", waMessageId: r.waMessageId });
}

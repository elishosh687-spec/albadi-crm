/**
 * POST /api/widget/drafts/[id]/reject?widget_token=...
 * Body: { reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { rejectDraft } from "@/lib/drafts";
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

  let reason: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    reason = body.reason;
  } catch {
    reason = undefined;
  }

  const r = await rejectDraft(draftId, reason);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }

  try {
    const [d] = await db
      .select({ sid: botDrafts.manychatSubId })
      .from(botDrafts)
      .where(eq(botDrafts.id, draftId))
      .limit(1);
    if (d?.sid) {
      void logLeadEvent({
        manychatSubId: d.sid,
        eventType: "draft_rejected",
        payload: { draftId, reason: reason ?? null, via: "widget" },
      });
    }
  } catch {}

  return NextResponse.json({ ok: true, message: "נדחה" });
}

/**
 * GET /api/widget/messages?sid=<sid>
 *
 * Returns the recent WhatsApp message thread for one lead, oldest→newest, so
 * the inbox widget can render an in-place conversation pane (list | thread).
 *
 * Auth: widget_token query param (validated by middleware on /api/widget/*).
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { messages } from "@/drizzle/schema";
import { sql, desc } from "drizzle-orm";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog("widget", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sid = (req.nextUrl.searchParams.get("sid") ?? "").trim();
  if (!sid) {
    return NextResponse.json({ ok: false, error: "missing_sid" }, { status: 400 });
  }

  // Newest 60, then reverse to chronological for rendering.
  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      text: messages.text,
      sender: messages.sender,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .where(sql`trim(${messages.manychatSubId}) = ${sid}`)
    .orderBy(desc(messages.receivedAt))
    .limit(60);

  return NextResponse.json({ ok: true, messages: rows.reverse() });
});

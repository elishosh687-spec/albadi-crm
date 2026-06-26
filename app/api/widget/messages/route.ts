/**
 * GET /api/widget/messages?sid=<sid>
 *
 * Returns the recent WhatsApp message thread for one lead, oldest→newest, so
 * the inbox widget can render an in-place conversation pane (list | thread).
 *
 * Auth: widget_token query param (validated by middleware on /api/widget/*).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { db } from "@/lib/db";
import { messages } from "@/drizzle/schema";
import { sql, desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) {
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
}

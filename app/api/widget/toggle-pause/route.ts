/**
 * POST /api/widget/toggle-pause?widget_token=...
 *
 * Toggle bot_paused for a single lead from the inbox widget.
 * Body: { sid: string, paused: boolean, sticky?: boolean }
 *
 * `sticky` is the "don't touch this lead" exception: the hourly resume sweep
 * skips it forever, no matter how the pause was set. Without it a deliberate
 * silence would quietly expire like any other.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { setBotPaused } from "@/app/actions/v2";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { sid?: string; paused?: boolean; sticky?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const sid = typeof body.sid === "string" ? body.sid.trim() : "";
  const paused = body.paused === true;
  if (!sid) return NextResponse.json({ ok: false, error: "missing sid" }, { status: 400 });

  const result = await setBotPaused(sid, paused);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  // Only meaningful while paused — setBotPaused(false) already clears it, so
  // writing sticky on a resume would leave a flag with nothing to exempt.
  const sticky = paused && body.sticky === true;
  if (sticky) {
    await db
      .update(leads)
      .set({ botPauseSticky: true, updatedAt: new Date() })
      .where(sql`trim(${leads.manychatSubId}) = ${sid}`);
  }

  return NextResponse.json({ ok: true, paused, sticky });
}

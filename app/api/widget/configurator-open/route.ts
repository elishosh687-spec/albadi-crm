/**
 * POST /api/widget/configurator-open?widget_token=...
 *
 * Create a configurator session bound to a lead and return the configurator
 * URL (with ?t=token) — for the AGENT to open and design FOR the customer,
 * then send the mockup from inside the configurator ("שלח ללקוח").
 * Body: { sid: string }
 *
 * Unlike /api/widget/send-configurator (which messages the customer a link),
 * this does NOT notify the customer — it just mints a contact-linked session.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { createConfiguratorSession } from "@/lib/configurator/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { sid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const sid = typeof body.sid === "string" ? body.sid.trim() : "";
  if (!sid) return NextResponse.json({ ok: false, error: "missing sid" }, { status: 400 });

  try {
    const { link } = await createConfiguratorSession(sid);
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

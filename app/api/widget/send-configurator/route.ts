/**
 * POST /api/widget/send-configurator?widget_token=...
 *
 * Send the personal 3D configurator link to a single lead over WhatsApp,
 * from the "מעצב 3D" hub tab. Body: { sid: string }
 *
 * Reuses sendConfiguratorLinkAction (creates a session token, sends the
 * CTA-url WhatsApp message, logs the lead event) — same flow as the
 * "שלח מעצב 3D" button in the leads view.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { sendConfiguratorLinkAction } from "@/app/actions/v2";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRequestLog("messaging", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    log.warn("unauthorized");
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

  const result = await sendConfiguratorLinkAction(sid);
  if (!result.ok) {
    log.error("configurator.send_failed", undefined, { sid, err_msg: result.error });
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  log.info("configurator.link_sent", { sid });
  return NextResponse.json({ ok: true, message: result.message ?? "נשלח מעצב 3D" });
});

/**
 * Bot settings API.
 *   GET → current values
 *   PUT → save (full object; unknown/badly-typed keys are dropped)
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { getBotSettings, saveBotSettings } from "@/lib/bot-settings/store";
import { DEFAULT_BOT_SETTINGS } from "@/lib/bot-settings/schema";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) return unauthorized();
  const settings = await getBotSettings({ fresh: true });
  return NextResponse.json({ ok: true, settings, defaults: DEFAULT_BOT_SETTINGS });
}

export async function PUT(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) return unauthorized();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  const settings = await saveBotSettings(body);
  return NextResponse.json({ ok: true, settings });
}

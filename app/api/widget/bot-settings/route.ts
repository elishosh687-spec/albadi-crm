/**
 * Bot settings API.
 *   GET → current values
 *   PUT → save (full object; unknown/badly-typed keys are dropped)
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { getBotSettings, saveBotSettings } from "@/lib/bot-settings/store";
import { DEFAULT_BOT_SETTINGS } from "@/lib/bot-settings/schema";
import { withRequestLog } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export const GET = withRequestLog("widget", async (req: NextRequest, log) => {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) {
    log.warn("unauthorized");
    return unauthorized();
  }
  const settings = await getBotSettings({ fresh: true });
  return NextResponse.json({ ok: true, settings, defaults: DEFAULT_BOT_SETTINGS });
});

export const PUT = withRequestLog("widget", async (req: NextRequest, log) => {
  const token = req.nextUrl.searchParams.get("widget_token") ?? "";
  if (!verifyWidgetToken(token)) {
    log.warn("unauthorized");
    return unauthorized();
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "bad_body" }, { status: 400 });
  }
  const settings = await saveBotSettings(body);
  log.info("bot_settings.saved", { keys: Object.keys(body as object).length });
  return NextResponse.json({ ok: true, settings });
});

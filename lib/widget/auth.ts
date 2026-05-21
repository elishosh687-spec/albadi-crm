/**
 * Shared helper: extract widget_token from query or Authorization header
 * and verify against GHL_WIDGET_TOKEN. Used by every /api/widget/* route.
 */

import { NextRequest } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export function widgetAuthed(req: NextRequest): boolean {
  const fromQuery = req.nextUrl.searchParams.get("widget_token");
  const fromHeader = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  return verifyWidgetToken(fromQuery) || verifyWidgetToken(fromHeader);
}

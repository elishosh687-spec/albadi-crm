/**
 * GET /api/widget/factory/fx-live?widget_token=...
 * Returns the current live market FX (USD→ILS, USD→CNY, CNY→ILS) for the
 * Settings "רענן עכשיו" button to drop into the form. Read-only — it does NOT
 * write the config (the operator saves the form to apply).
 */

import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { widgetAuthed } from "@/lib/widget/auth";
import { getLiveFx } from "@/lib/fx/live-rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequestLog("fx", async (req: NextRequest, log) => {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const fx = await getLiveFx({ fresh });
  return NextResponse.json({ ok: true, fx });
});

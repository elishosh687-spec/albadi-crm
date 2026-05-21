/**
 * GET /api/widget/factory/config?widget_token=...
 *
 * Returns FactoryPricingConfig (shipping options, FX rates, margin defaults).
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { getFactoryConfig } from "@/lib/factory/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const config = await getFactoryConfig({ fresh: true });
  return NextResponse.json({ ok: true, config });
}

/**
 * GET  /api/widget/factory/config?widget_token=... — returns FactoryPricingConfig.
 * PUT  /api/widget/factory/config?widget_token=... — body: full FactoryPricingConfig,
 *                                                    overwrites the row.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { getFactoryConfig, setFactoryConfig } from "@/lib/factory/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const config = await getFactoryConfig({ fresh: true });
  return NextResponse.json({ ok: true, config });
}

export async function PUT(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    await setFactoryConfig(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }
}

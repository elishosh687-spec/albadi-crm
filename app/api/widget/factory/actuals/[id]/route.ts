/**
 * PUT /api/widget/factory/actuals/<id>?widget_token=...
 * Body: QuoteActualCosts — the real factory/shipping/other costs for a WON deal.
 * Saved to factory_quote_requests.actual_costs (separate from finalPricing).
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { saveActualCosts } from "@/lib/factory/server/closed";
import type { QuoteActualCosts } from "@/lib/factory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }
  try {
    const body = (await req.json()) as QuoteActualCosts;
    await saveActualCosts(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }
}

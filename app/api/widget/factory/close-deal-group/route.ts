/**
 * POST /api/widget/factory/close-deal-group?widget_token=...
 * Body: { quoteIds: string[] }
 *
 * "סגור עסקה משולבת" — close several finalized quotes of one customer as ONE
 * combined deal (multi-product, one invoice). Sets a shared deal_group_id.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { closeDealGroup } from "@/lib/factory/server/closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    quoteIds?: string[];
    // Optional — the merged-CBM override / air-sea split the operator had on
    // screen, so the frozen combined offer matches the PDF that was sent.
    cbmOverride?: number | null;
    split?: { airIds: string[]; airShippingOptionId: string; seaShippingOptionId: string } | null;
  };
  if (!Array.isArray(body.quoteIds) || body.quoteIds.length === 0) {
    return NextResponse.json({ ok: false, error: "missing quoteIds" }, { status: 400 });
  }
  try {
    const groupId = await closeDealGroup(body.quoteIds, {
      cbmOverride: body.cbmOverride ?? null,
      split: body.split ?? null,
    });
    return NextResponse.json({ ok: true, groupId });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 }
    );
  }
}

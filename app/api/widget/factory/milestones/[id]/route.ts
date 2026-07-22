/**
 * PUT /api/widget/factory/milestones/<id>?widget_token=...
 * Body: Partial<DealMilestones> — stage stamps (ISO or null to clear), notes,
 * invoiceZohoId, or full file arrays (for deletes). Merge semantics.
 * Newly-flipped stamps are mirrored to the lead's GHL contact (non-fatal).
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import {
  mirrorDealEventToGhl,
  saveDealMilestones,
  STAGE_LABELS_HE,
} from "@/lib/factory/server/milestones";
import type { DealMilestones } from "@/lib/factory/types";

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
    const patch = (await req.json()) as Partial<DealMilestones>;
    const { merged, newlyStamped } = await saveDealMilestones(id, patch);
    if (newlyStamped.length > 0) {
      await mirrorDealEventToGhl(
        id,
        newlyStamped.map((k) => `✓ ${STAGE_LABELS_HE[k]}`)
      );
    }
    return NextResponse.json({ ok: true, milestones: merged });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "save_failed" },
      { status: 400 }
    );
  }
}

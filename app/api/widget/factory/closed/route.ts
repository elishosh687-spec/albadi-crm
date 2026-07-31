/**
 * GET /api/widget/factory/closed?widget_token=...
 * Lists every WON + finalized factory quote with its planned pricing snapshot
 * and any saved actual-cost reconciliation. Feeds the "הצעות שנסגרו" screen.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { listClosedQuotes } from "@/lib/factory/server/closed";
import { computeAccuracyStats } from "@/lib/factory/server/accuracy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const [quotes, stats] = await Promise.all([
    listClosedQuotes(),
    // Accuracy strip is decoration — never fail the screen over it.
    computeAccuracyStats().catch((err) => {
      console.warn("[factory/closed] accuracy stats failed (non-fatal)", err);
      return null;
    }),
  ]);
  return NextResponse.json({ ok: true, quotes, stats });
}

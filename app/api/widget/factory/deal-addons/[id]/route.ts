/**
 * PUT /api/widget/factory/deal-addons/[id]?widget_token=...
 *   body: { addons: [{ label, amountIls }] }
 *
 * Amounts added to an already-closed deal — "the customer asked for 500 more at
 * the price I gave him". Replaces the whole list (the UI sends the full array),
 * so removing a line is just sending it without that entry.
 *
 * Stored on the PRIMARY member, like every other deal-level field. Flows into
 * grandTotalExVat → payment schedule → Zoho invoice via listClosedQuotes.
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import type { DealAddon } from "@/lib/factory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const raw = Array.isArray((body as { addons?: unknown }).addons)
    ? ((body as { addons: unknown[] }).addons as Record<string, unknown>[])
    : [];

  const clean: DealAddon[] = raw
    .map((a) => ({
      label: String(a.label ?? "").trim().slice(0, 160),
      amountIls: Math.round(Number(a.amountIls) * 100) / 100,
      addedAt:
        typeof a.addedAt === "string" && a.addedAt
          ? a.addedAt
          : new Date().toISOString(),
    }))
    // A line with no amount is meaningless; a line with no label is unexplainable
    // on the invoice — drop both rather than bill something nameless.
    .filter((a) => a.label.length > 0 && Number.isFinite(a.amountIls) && a.amountIls !== 0);

  const res = await db
    .update(factoryQuoteRequests)
    .set({ dealAddons: clean, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id))
    .returning({ id: factoryQuoteRequests.id });
  if (res.length === 0) {
    return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    addons: clean,
    totalIls: Math.round(clean.reduce((s, a) => s + a.amountIls, 0) * 100) / 100,
  });
}

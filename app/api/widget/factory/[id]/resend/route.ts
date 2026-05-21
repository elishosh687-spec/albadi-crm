/**
 * POST /api/widget/factory/[id]/resend?widget_token=...
 * Creates a NEW factory_quote_requests row from an existing one's spec.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { createFactoryRequest } from "@/lib/factory/create-request";
import type { FactoryProductSpec } from "@/lib/factory/types";
import { widgetAuthed } from "@/lib/widget/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const [src] = await db
    .select({
      manychatSubId: factoryQuoteRequests.manychatSubId,
      productSpec: factoryQuoteRequests.productSpec,
      customerName: leads.name,
    })
    .from(factoryQuoteRequests)
    .leftJoin(leads, eq(leads.manychatSubId, factoryQuoteRequests.manychatSubId))
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  if (!src) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const result = await createFactoryRequest({
      manychatSubId: src.manychatSubId,
      productSpec: src.productSpec as FactoryProductSpec,
      customerName: src.customerName ?? undefined,
      clearDraft: false,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[widget/factory/resend] failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "feishu_append_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}

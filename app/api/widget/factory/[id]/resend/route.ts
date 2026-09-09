/**
 * POST /api/widget/factory/[id]/resend?widget_token=...
 * Creates a NEW factory_quote_requests row from an existing one's spec.
 */

import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { createFactoryRequest } from "@/lib/factory/create-request";
import type { FactoryProductSpec } from "@/lib/factory/types";
import { widgetAuthed } from "@/lib/widget/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withRequestLog("factory", async (
  req: NextRequest,
  log,
  ctx: { params: Promise<{ id: string }> }
) => {
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
    log.error("resend.failed", err, { quoteId: id, sid: src.manychatSubId });
    return NextResponse.json(
      {
        ok: false,
        error: "feishu_append_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
});

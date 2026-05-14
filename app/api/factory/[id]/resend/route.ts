/**
 * POST /api/factory/[id]/resend
 *
 * Creates a NEW factory_quote_requests row from an existing one's spec and
 * appends it to Feishu as a fresh row. Used by the history list to re-send
 * a past quote without retyping. Does NOT touch the lead's factorySpecDraft
 * (this is a history-driven re-send, not a draft submission).
 *
 * Auth: dashboard cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { createFactoryRequest } from "@/lib/factory/create-request";
import type { FactoryProductSpec } from "@/lib/factory/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  return !!cookie && cookie.value === process.env.ADMIN_PASSWORD;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

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
    console.error("[factory/resend] failed", err);
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

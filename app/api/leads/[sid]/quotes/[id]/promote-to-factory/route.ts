/**
 * POST /api/leads/[sid]/quotes/[id]/promote-to-factory
 *
 * Reads the historical bot_quotes row's q_state snapshot, decodes it into a
 * FactoryProductSpec, and calls createFactoryRequest — the same path used by
 * FactoryQuotePanel's "send from summary" button. Result: a new
 * factory_quote_requests row keyed to this lead, written to Feishu.
 *
 * Lets the operator pick any prior quote from the history accordion (initial
 * or a specific requote) and promote it to factory-order status without
 * manually re-typing the spec.
 *
 * Auth: dashboard cookie (albadi_auth == ADMIN_PASSWORD).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { botQuotes, leads } from "@/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { qStateToFactoryProductSpec } from "@/lib/factory/qstate-decode";
import { createFactoryDraft } from "@/lib/factory/create-request";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  return !!cookie && cookie.value === process.env.ADMIN_PASSWORD;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string; id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { sid: rawSid, id: rawId } = await params;
  const sid = decodeURIComponent(rawSid).trim();
  const quoteId = Number(rawId);
  if (!sid || !Number.isInteger(quoteId) || quoteId <= 0) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: botQuotes.id,
      leadSid: botQuotes.leadSid,
      qState: botQuotes.qState,
    })
    .from(botQuotes)
    .where(
      and(
        eq(botQuotes.id, quoteId),
        sql`trim(${botQuotes.leadSid}) = ${sid}`
      )
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "quote_not_found" }, { status: 404 });
  }

  const spec = qStateToFactoryProductSpec(
    row.qState as Record<string, unknown>
  );
  if (!spec) {
    return NextResponse.json(
      { error: "qstate_incomplete", detail: "no decodable spec on this quote" },
      { status: 422 }
    );
  }
  if (spec.quantity <= 0 || (spec.widthCm <= 0 && spec.heightCm <= 0)) {
    return NextResponse.json(
      { error: "spec_missing_required", detail: "quantity / dimensions missing" },
      { status: 422 }
    );
  }

  const [leadRow] = await db
    .select({ name: leads.name })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);

  try {
    // Create a DRAFT (status='draft') — does NOT push to Feishu. The operator
    // reviews the parked row in FactoryQuotePanel and clicks "שלח ל-Feishu"
    // there when ready (POST /api/factory/[id]/send-to-feishu, which calls
    // promoteDraftToFeishu). This keeps "promote from bot history" as a
    // staging action rather than a live send.
    const result = await createFactoryDraft({
      manychatSubId: sid,
      productSpec: spec,
      customerName: leadRow?.name ?? undefined,
    });
    return NextResponse.json({
      ok: true,
      quoteId,
      mode: "draft",
      ...result,
    });
  } catch (err) {
    console.error(
      "[promote-to-factory] createFactoryDraft failed",
      err
    );
    return NextResponse.json(
      {
        ok: false,
        error: "factory_draft_create_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

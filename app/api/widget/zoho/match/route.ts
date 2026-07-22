/**
 * GET /api/widget/zoho/match?dealId=<factory_quote_requests.id>&widget_token=...
 *
 * Ranked Zoho Books candidates for one closed deal's actuals — feeds the
 * "משוך מ-Zoho" picker in the closed-quotes screen. Read-only against Zoho.
 * When Zoho isn't configured returns { configured: false } (UI shows a hint).
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { zohoConfigured } from "@/lib/zoho/client";
import { matchZohoDocsToDeal } from "@/lib/zoho/match";
import type { FactoryPricingResult } from "@/lib/factory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!zohoConfigured()) {
    return NextResponse.json({ ok: true, configured: false });
  }
  const dealId = req.nextUrl.searchParams.get("dealId") ?? "";
  if (!dealId) {
    return NextResponse.json({ ok: false, error: "missing dealId" }, { status: 400 });
  }

  const [row] = await db
    .select({
      finalPricing: factoryQuoteRequests.finalPricing,
      sentToCustomerAt: factoryQuoteRequests.sentToCustomerAt,
      updatedAt: factoryQuoteRequests.updatedAt,
      customerName: leads.name,
    })
    .from(factoryQuoteRequests)
    .leftJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(eq(factoryQuoteRequests.id, dealId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ ok: false, error: "deal not found" }, { status: 404 });
  }
  const fp = (row.finalPricing ?? null) as FactoryPricingResult | null;

  try {
    const suggestions = await matchZohoDocsToDeal({
      customerName: row.customerName,
      closedAt: (row.sentToCustomerAt ?? row.updatedAt)?.toISOString() ?? null,
      plannedRevenueIls: fp?.totalSellingPrice ?? null,
      plannedFactoryIls: fp?.totalCost ?? null,
      plannedShippingIls: fp?.totalShipping ?? null,
    });
    return NextResponse.json({ ok: true, configured: true, suggestions });
  } catch (err) {
    console.error("[zoho/match] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "zoho fetch failed" },
      { status: 502 }
    );
  }
}

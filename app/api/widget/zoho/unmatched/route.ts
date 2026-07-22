/**
 * GET /api/widget/zoho/unmatched?widget_token=...
 *
 * Recent Zoho docs (90d) that are NOT referenced by any deal's
 * actualCosts.zohoRefs — the "חשבוניות Zoho שלא שויכו לעסקה" reminder panel.
 * Returns { configured: false } when Zoho creds are absent.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { isNotNull } from "drizzle-orm";
import {
  listZohoBills,
  listZohoExpenses,
  listZohoInvoices,
  zohoConfigured,
} from "@/lib/zoho/client";
import type { QuoteActualCosts } from "@/lib/factory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!zohoConfigured()) {
    return NextResponse.json({ ok: true, configured: false });
  }

  try {
    const [invoices, bills, expenses, rows] = await Promise.all([
      listZohoInvoices({ sinceDays: 90 }),
      listZohoBills({ sinceDays: 90 }),
      listZohoExpenses({ sinceDays: 90 }),
      db
        .select({ actualCosts: factoryQuoteRequests.actualCosts })
        .from(factoryQuoteRequests)
        .where(isNotNull(factoryQuoteRequests.actualCosts)),
    ]);

    const linked = new Set<string>();
    for (const r of rows) {
      const ac = r.actualCosts as QuoteActualCosts | null;
      for (const ref of ac?.zohoRefs ?? []) linked.add(`${ref.type}:${ref.id}`);
    }

    const unmatched = [...invoices, ...bills, ...expenses]
      .filter((d) => !linked.has(`${d.type}:${d.id}`))
      // Drafts/voided docs aren't money that moved.
      .filter((d) => !/draft|void/i.test(d.status))
      .sort((a, b) => (b.date > a.date ? 1 : -1))
      .slice(0, 30);

    return NextResponse.json({ ok: true, configured: true, unmatched });
  } catch (err) {
    console.error("[zoho/unmatched] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "zoho fetch failed" },
      { status: 502 }
    );
  }
}

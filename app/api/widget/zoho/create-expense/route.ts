/**
 * POST /api/widget/zoho/create-expense?widget_token=...
 * Body: { dealId, category: "cogs"|"commission"|"custom", accountId?, partner,
 *         amount, currency, exchangeRate?, description, applyTo?: "factory"|"shipping"|"other"|null }
 *
 * Records an order expense in Zoho Books (Eli's rules: no VAT on imports,
 * paid through a partner account, customer-linked, order-tag best-effort),
 * and optionally rolls the ₪ amount into the deal's actualCosts bucket.
 *
 * GET  /api/widget/zoho/create-expense — returns the expense-account list for
 * the "custom" bucket dropdown (yes, a GET on the same path, keeps the UI to
 * one endpoint).
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { zohoConfigured } from "@/lib/zoho/client";
import { createZohoExpense, listExpenseAccounts } from "@/lib/zoho/write";
import { saveActualCosts } from "@/lib/factory/server/closed";
import type { QuoteActualCosts } from "@/lib/factory/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!zohoConfigured()) return NextResponse.json({ ok: true, configured: false, accounts: [] });
  try {
    const accounts = await listExpenseAccounts();
    return NextResponse.json({ ok: true, configured: true, accounts });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "accounts_failed" },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!zohoConfigured()) {
    return NextResponse.json({ ok: false, error: "zoho_not_configured" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    dealId?: string;
    category?: "cogs" | "commission" | "custom";
    accountId?: string;
    partner?: string;
    amount?: number;
    currency?: string;
    exchangeRate?: number;
    description?: string;
    applyTo?: "factory" | "shipping" | "other" | null;
  };
  if (!body.dealId || !body.category || !body.partner || !body.amount || !body.currency) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: factoryQuoteRequests.id,
      actualCosts: factoryQuoteRequests.actualCosts,
      customerName: leads.name,
    })
    .from(factoryQuoteRequests)
    .leftJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(eq(factoryQuoteRequests.id, body.dealId))
    .limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "deal not found" }, { status: 404 });

  try {
    const result = await createZohoExpense({
      category: body.category,
      accountId: body.accountId,
      partner: body.partner,
      amount: body.amount,
      currency: body.currency,
      exchangeRate: body.exchangeRate,
      description: body.description ?? "",
      customerName: row.customerName,
    });

    // roll into the reconciliation bucket + link-back ref
    if (body.applyTo) {
      const ac = (row.actualCosts ?? {}) as QuoteActualCosts;
      const ils = Math.round(result.bcyTotalIls * 100) / 100;
      const patch: QuoteActualCosts = {
        ...ac,
        zohoRefs: [
          ...(ac.zohoRefs ?? []),
          {
            type: "expense",
            id: result.expenseId,
            number: undefined,
            amountIls: ils,
            date: new Date().toISOString().slice(0, 10),
            party: row.customerName ?? undefined,
          },
        ],
      };
      if (body.applyTo === "factory") patch.factoryTotalIls = (ac.factoryTotalIls ?? 0) + ils;
      else if (body.applyTo === "shipping") patch.shippingTotalIls = (ac.shippingTotalIls ?? 0) + ils;
      else {
        patch.otherCosts = [
          ...(ac.otherCosts ?? []),
          { label: (body.description ?? "הוצאה").slice(0, 60), amountIls: ils },
        ];
      }
      await saveActualCosts(row.id, patch);
    }

    return NextResponse.json({
      ok: true,
      expenseId: result.expenseId,
      bcyTotalIls: result.bcyTotalIls,
      exchangeRate: result.exchangeRate,
      customerLinked: result.customerLinked,
      tagApplied: result.tagApplied,
    });
  } catch (err) {
    console.error("[zoho/create-expense] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "expense_failed" },
      { status: 502 }
    );
  }
}

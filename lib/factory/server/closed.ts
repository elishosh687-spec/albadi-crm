/**
 * Closed-deal reconciliation server helpers.
 *
 * "הצעות שנסגרו" screen: every finalized factory quote whose lead is WON.
 * Eli enters the REAL factory + shipping (+ other) costs after fulfilment and
 * compares them against the planned finalPricing snapshot. See QuoteActualCosts.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, desc, eq } from "drizzle-orm";
import type { FactoryPricingResult, QuoteActualCosts } from "@/lib/factory/types";

export interface ClosedQuoteRow {
  id: string;
  leadSid: string;
  quotationNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  productSpec: Record<string, unknown> | null;
  finalPricing: FactoryPricingResult | null;
  actualCosts: QuoteActualCosts | null;
  sentToCustomerAt: string | null;
  updatedAt: string;
}

/** Every WON + finalized factory quote, newest first. */
export async function listClosedQuotes(): Promise<ClosedQuoteRow[]> {
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      leadSid: factoryQuoteRequests.manychatSubId,
      quotationNo: factoryQuoteRequests.quotationNo,
      productSpec: factoryQuoteRequests.productSpec,
      finalPricing: factoryQuoteRequests.finalPricing,
      actualCosts: factoryQuoteRequests.actualCosts,
      sentToCustomerAt: factoryQuoteRequests.sentToCustomerAt,
      updatedAt: factoryQuoteRequests.updatedAt,
      customerName: leads.name,
      customerPhone: leads.phoneE164,
    })
    .from(factoryQuoteRequests)
    .innerJoin(leads, eq(leads.manychatSubId, factoryQuoteRequests.manychatSubId))
    .where(
      and(
        eq(factoryQuoteRequests.factoryStatus, "finalized"),
        eq(leads.pipelineStage, "WON")
      )
    )
    .orderBy(desc(factoryQuoteRequests.updatedAt))
    .limit(300);

  return rows.map((r) => ({
    id: r.id,
    leadSid: r.leadSid,
    quotationNo: r.quotationNo,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    productSpec: (r.productSpec ?? null) as Record<string, unknown> | null,
    finalPricing: (r.finalPricing ?? null) as FactoryPricingResult | null,
    actualCosts: (r.actualCosts ?? null) as QuoteActualCosts | null,
    sentToCustomerAt: r.sentToCustomerAt ? r.sentToCustomerAt.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Upsert the actual-cost reconciliation for one quote. Stamps updatedAt. */
export async function saveActualCosts(
  id: string,
  actuals: QuoteActualCosts
): Promise<void> {
  const clean: QuoteActualCosts = {
    factoryTotalIls: numOrUndef(actuals.factoryTotalIls),
    shippingTotalIls: numOrUndef(actuals.shippingTotalIls),
    actualRevenueIls: numOrUndef(actuals.actualRevenueIls),
    otherCosts: Array.isArray(actuals.otherCosts)
      ? actuals.otherCosts
          .map((c) => ({ label: String(c.label ?? "").slice(0, 120), amountIls: Number(c.amountIls) }))
          .filter((c) => Number.isFinite(c.amountIls) && c.amountIls !== 0)
      : undefined,
    zohoRefs: Array.isArray(actuals.zohoRefs)
      ? actuals.zohoRefs
          .filter((z) => z && typeof z.id === "string" && z.id)
          .slice(0, 20)
          .map((z) => ({
            type: z.type === "invoice" || z.type === "bill" || z.type === "expense" ? z.type : "expense",
            id: String(z.id).slice(0, 80),
            number: z.number ? String(z.number).slice(0, 60) : undefined,
            amountIls: numOrUndef(z.amountIls),
            date: z.date ? String(z.date).slice(0, 20) : undefined,
            party: z.party ? String(z.party).slice(0, 120) : undefined,
          }))
      : undefined,
    note: actuals.note ? String(actuals.note).slice(0, 2000) : undefined,
    updatedAt: new Date().toISOString(),
  };
  await db
    .update(factoryQuoteRequests)
    .set({ actualCosts: clean, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));
}

function numOrUndef(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

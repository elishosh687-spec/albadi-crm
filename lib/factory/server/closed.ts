/**
 * Closed-deal reconciliation server helpers.
 *
 * "הצעות שנסגרו" screen: every finalized factory quote whose lead is WON.
 * Eli enters the REAL factory + shipping (+ other) costs after fulfilment and
 * compares them against the planned finalPricing snapshot. See QuoteActualCosts.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { DealMilestones, FactoryPricingResult, QuoteActualCosts } from "@/lib/factory/types";

/** One product line inside a deal (a deal has 1, or N when combined). */
export interface DealProduct {
  id: string;
  quotationNo: string | null;
  productSpec: Record<string, unknown> | null;
  finalPricing: FactoryPricingResult | null;
}

export interface ClosedQuoteRow {
  /** Primary member id — actuals / milestones / invoice attach here. */
  id: string;
  dealGroupId: string | null;
  leadSid: string;
  quotationNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  productSpec: Record<string, unknown> | null;
  /** Combined summary for a group; the single quote's pricing otherwise. */
  finalPricing: FactoryPricingResult | null;
  actualCosts: QuoteActualCosts | null;
  dealMilestones: DealMilestones | null;
  sentToCustomerAt: string | null;
  updatedAt: string;
  explicitlyClosed: boolean;
  /** The product lines in this deal (1 for single, N for combined). */
  products: DealProduct[];
  isCombined: boolean;
  /** True when the deal was closed on a DRAFT (self-estimate), not a factory
   *  quote — the planned price is the estimate, not factory-confirmed. */
  fromEstimate: boolean;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Combine N ALREADY-CLOSED members into one deal summary by SUMMING them.
 *
 *  Each member was finalized and closed with the customer at its own agreed
 *  price, so the deal's revenue is the SUM of those agreed prices — NOT a
 *  re-discounted combined quote. We deliberately do NOT re-run allocateCombined
 *  here: that engine is for pre-sale QUOTING (offer a single-shipment discount
 *  to win the deal). Post-close, the price is locked.
 *
 *  The single-shipment shipping saving is real, but it's Eli's realized PROFIT
 *  (he charged for N shipments, ships once) — it surfaces on the ACTUAL side
 *  when he pulls the real shipping cost from Zoho (shippingDelta < 0 → profit
 *  rises), never as a retroactive discount to the customer.
 *
 *  Summing also keeps profit correct: each member's totalProfit is margin-only
 *  (shipping is pass-through, excluded), so the sum is the true combined profit
 *  — unlike the old `grandTotal − cost` which folded shipping into profit. */
function combineMembers(members: FactoryPricingResult[]): FactoryPricingResult {
  const quantity = members.reduce((s, m) => s + (m.quantity || 0), 0);
  const totalCost = r2(members.reduce((s, m) => s + (m.totalCost || 0), 0));
  const totalShipping = r2(members.reduce((s, m) => s + (m.totalShipping || 0), 0));
  const totalProfit = r2(members.reduce((s, m) => s + (m.totalProfit || 0), 0));
  const totalSellingPrice = r2(members.reduce((s, m) => s + (m.totalSellingPrice || 0), 0));
  return {
    ...members[0],
    quantity,
    unitCost: quantity > 0 ? r2(totalCost / quantity) : totalCost,
    unitShipping: quantity > 0 ? r2(totalShipping / quantity) : totalShipping,
    unitProfit: quantity > 0 ? r2(totalProfit / quantity) : totalProfit,
    unitSellingPrice: quantity > 0 ? r2(totalSellingPrice / quantity) : totalSellingPrice,
    totalCost,
    totalShipping,
    totalProfit,
    totalSellingPrice,
    totalCartons: members.reduce((s, m) => s + (m.totalCartons || 0), 0),
    totalWeightKg: r2(members.reduce((s, m) => s + (m.totalWeightKg || 0), 0)),
    totalCbm: r2(members.reduce((s, m) => s + (m.totalCbm || 0), 0)),
    moldsTotalCny: members.reduce((s, m) => s + (m.moldsTotalCny || 0), 0),
    moldsTotalCostIls: r2(members.reduce((s, m) => s + (m.moldsTotalCostIls || 0), 0)),
    moldsTotalSellingPriceIls: r2(members.reduce((s, m) => s + (m.moldsTotalSellingPriceIls || 0), 0)),
    moldsTotalProfitIls: r2(members.reduce((s, m) => s + (m.moldsTotalProfitIls || 0), 0)),
  };
}

/**
 * Deals in the עסקאות tab: a finalized quote appears when EITHER
 *  - it was explicitly pulled in via "סגור עסקה" (closed_deal_at set), OR
 *  - its lead is marked WON (legacy/auto path).
 * Quotes sharing a deal_group_id collapse into ONE combined deal (multi-product,
 * one invoice), priced by SUMMING the already-agreed member prices (see
 * combineMembers) — the deal is closed, so the customer pays the sum, not a
 * re-discounted combined quote.
 */
export async function listClosedQuotes(): Promise<ClosedQuoteRow[]> {
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      leadSid: factoryQuoteRequests.manychatSubId,
      quotationNo: factoryQuoteRequests.quotationNo,
      productSpec: factoryQuoteRequests.productSpec,
      finalPricing: factoryQuoteRequests.finalPricing,
      actualCosts: factoryQuoteRequests.actualCosts,
      dealMilestones: factoryQuoteRequests.dealMilestones,
      sentToCustomerAt: factoryQuoteRequests.sentToCustomerAt,
      createdAt: factoryQuoteRequests.createdAt,
      updatedAt: factoryQuoteRequests.updatedAt,
      closedDealAt: factoryQuoteRequests.closedDealAt,
      dealGroupId: factoryQuoteRequests.dealGroupId,
      factoryStatus: factoryQuoteRequests.factoryStatus,
      customerName: leads.name,
      customerPhone: leads.phoneE164,
    })
    .from(factoryQuoteRequests)
    .innerJoin(leads, eq(leads.manychatSubId, factoryQuoteRequests.manychatSubId))
    .where(
      and(
        isNull(factoryQuoteRequests.deletedAt),
        isNotNull(factoryQuoteRequests.finalPricing),
        or(
          // Explicitly pulled in via "סגור עסקה" — a finalized quote OR a
          // priced draft the customer accepted on the estimate directly.
          isNotNull(factoryQuoteRequests.closedDealAt),
          // Legacy auto: finalized + lead WON.
          and(
            eq(factoryQuoteRequests.factoryStatus, "finalized"),
            eq(leads.pipelineStage, "WON")
          )
        )
      )
    )
    .orderBy(desc(factoryQuoteRequests.updatedAt))
    .limit(500);

  // Group rows into deals: shared deal_group_id → one deal; else keyed by own id.
  const byDeal = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.dealGroupId ?? r.id;
    const list = byDeal.get(key);
    if (list) list.push(r);
    else byDeal.set(key, [r]);
  }

  const deals: ClosedQuoteRow[] = [];
  for (const members of byDeal.values()) {
    // primary = oldest member (stable; where actuals/milestones live)
    members.sort((a, b) => +a.createdAt - +b.createdAt);
    const primary = members[0];
    const products: DealProduct[] = members.map((m) => ({
      id: m.id,
      quotationNo: m.quotationNo,
      productSpec: (m.productSpec ?? null) as Record<string, unknown> | null,
      finalPricing: (m.finalPricing ?? null) as FactoryPricingResult | null,
    }));
    const isCombined = members.length > 1;
    let finalPricing = (primary.finalPricing ?? null) as FactoryPricingResult | null;
    if (isCombined) {
      const priced = products.map((p) => p.finalPricing).filter((p): p is FactoryPricingResult => !!p);
      if (priced.length > 1) finalPricing = combineMembers(priced);
    }
    // newest updatedAt across members drives the deal's sort/recency
    const newest = members.reduce((a, b) => (+a.updatedAt > +b.updatedAt ? a : b));
    deals.push({
      id: primary.id,
      dealGroupId: primary.dealGroupId,
      leadSid: primary.leadSid,
      quotationNo: primary.quotationNo,
      customerName: primary.customerName,
      customerPhone: primary.customerPhone,
      productSpec: (primary.productSpec ?? null) as Record<string, unknown> | null,
      finalPricing,
      actualCosts: (primary.actualCosts ?? null) as QuoteActualCosts | null,
      dealMilestones: (primary.dealMilestones ?? null) as DealMilestones | null,
      sentToCustomerAt: primary.sentToCustomerAt ? primary.sentToCustomerAt.toISOString() : null,
      updatedAt: newest.updatedAt.toISOString(),
      explicitlyClosed: members.some((m) => m.closedDealAt != null),
      products,
      isCombined,
      fromEstimate: members.every((m) => m.factoryStatus !== "finalized"),
    });
  }
  deals.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  return deals;
}

/**
 * "סגור עסקה משולבת" — close several finalized quotes of one customer as ONE
 * combined deal (shared deal_group_id + closed stamp). Returns the group id.
 */
export async function closeDealGroup(quoteIds: string[]): Promise<string> {
  const ids = [...new Set(quoteIds.filter(Boolean))].sort();
  if (ids.length === 0) throw new Error("no quote ids");
  // Deterministic group id from the primary (sorted-first) quote — idempotent.
  const groupId = `dg_${ids[0]}`;
  await db
    .update(factoryQuoteRequests)
    .set({ closedDealAt: new Date(), dealGroupId: groupId, updatedAt: new Date() })
    .where(inArray(factoryQuoteRequests.id, ids));
  return groupId;
}

/** Ungroup a combined deal (clear group id on all its members). */
export async function unbindDealGroup(groupId: string): Promise<void> {
  await db
    .update(factoryQuoteRequests)
    .set({ dealGroupId: null, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.dealGroupId, groupId));
}

/** Quote ids belonging to a deal (for multi-line invoice creation). */
export async function dealMemberIds(primaryId: string): Promise<string[]> {
  const [row] = await db
    .select({ groupId: factoryQuoteRequests.dealGroupId })
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, primaryId))
    .limit(1);
  if (!row?.groupId) return [primaryId];
  const members = await db
    .select({ id: factoryQuoteRequests.id })
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.dealGroupId, row.groupId))
    .orderBy(asc(factoryQuoteRequests.createdAt));
  return members.map((m) => m.id);
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

/**
 * "סגור עסקה" — pull a finalized quote into the עסקאות tab (or push it back
 * out). Sets/clears closed_deal_at. Independent of the lead's pipeline stage.
 */
export async function setDealClosed(id: string, closed: boolean): Promise<void> {
  await db
    .update(factoryQuoteRequests)
    .set({ closedDealAt: closed ? new Date() : null, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));
}

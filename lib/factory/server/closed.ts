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
import type {
  DealMilestones,
  FactoryPricingResult,
  QuoteActualCosts,
  FactoryProductSpec,
  FactoryResponse,
  FactoryQuoteStatus,
} from "@/lib/factory/types";
import { splitCustomerView } from "@/lib/factory/shipping-split";
import {
  resolveDealSchedule,
  type StoredDealPlan,
  type PaymentSchedule,
} from "@/lib/factory/payment-terms";

/** One product line inside a deal (a deal has 1, or N when combined). Shaped as
 *  a full FactoryQuoteRow so the deal card can render the SAME quote preview
 *  (customer + boss toggle) shown on the הצעות מחיר tab — no separate PDF/breakdown. */
export interface DealProduct {
  id: string;
  manychatSubId: string;
  quotationNo: string | null;
  createdAt: string;
  updatedAt: string;
  productSpec: FactoryProductSpec;
  feishuRowIndex: string | null;
  factoryStatus: FactoryQuoteStatus;
  factoryResponse: FactoryResponse | null;
  finalPricing: FactoryPricingResult | null;
  pdfUrl: string | null;
  sentToCustomerAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
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
  /** Customer payment schedule for THIS deal (VAT + amount due + installments),
   *  computed on the customer grand total (combined = sum of members, split-aware)
   *  using the primary's stored payment_plan. Null when no plan is stored. */
  paymentSchedule: PaymentSchedule | null;
  /** Human label of the plan (e.g. "50% / 50%" or the custom label). */
  paymentPlanLabel: string | null;
  /** Stored preset id (`50_50` / `30_70` / `30_40_30` / `custom_NN`). Null when
   *  no plan is stored, or when the deal carries a custom installments object
   *  (which has no id — read `paymentSchedule.installments` instead). */
  paymentPlanId: string | null;
}

/** A member's customer-facing grand total (ex-VAT), matching what the PDF/message
 *  prints: split shipments round per-leg (splitCustomerView), else rounded
 *  per-bag × qty + one-time molds. Mirrors pdf.tsx displayTotalOrder.
 *
 *  Exported because the read API (`/api/widget/deals`) must quote the SAME
 *  figure the customer received — the payment schedule is computed on it. */
export function memberDisplayTotalExVat(fp: FactoryPricingResult): number {
  const moldTotalIls = (fp.moldsTotalSellingPriceIls ?? 0) > 0 ? r2(fp.moldsTotalSellingPriceIls) : 0;
  if (fp.shippingSplit) {
    return splitCustomerView(fp.shippingSplit, moldTotalIls).grandTotalIls;
  }
  return r2(r2(fp.unitSellingPrice) * fp.quantity) + moldTotalIls;
}

/** A readable label for a stored plan (id or custom object). */
function planLabel(stored: StoredDealPlan | null | undefined): string | null {
  if (!stored) return null;
  if (typeof stored === "object") return stored.label ?? "תנאי תשלום מותאמים";
  const map: Record<string, string> = {
    "50_50": "50% / 50%",
    "30_70": "30% / 70%",
    "30_40_30": "3 פעימות — 30% / 40% / 30%",
  };
  return map[stored] ?? stored;
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
      factoryResponse: factoryQuoteRequests.factoryResponse,
      feishuRowIndex: factoryQuoteRequests.feishuRowIndex,
      pdfUrl: factoryQuoteRequests.pdfUrl,
      paymentPlan: factoryQuoteRequests.paymentPlan,
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
        // "הסר מעסקאות" tombstone — hides the deal even when the lead is WON.
        isNull(factoryQuoteRequests.dealRemovedAt),
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
      manychatSubId: m.leadSid,
      quotationNo: m.quotationNo,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      productSpec: (m.productSpec ?? {}) as FactoryProductSpec,
      feishuRowIndex: m.feishuRowIndex,
      factoryStatus: m.factoryStatus as FactoryQuoteStatus,
      factoryResponse: (m.factoryResponse ?? null) as FactoryResponse | null,
      finalPricing: (m.finalPricing ?? null) as FactoryPricingResult | null,
      pdfUrl: m.pdfUrl,
      sentToCustomerAt: m.sentToCustomerAt ? m.sentToCustomerAt.toISOString() : null,
      customerName: m.customerName,
      customerPhone: m.customerPhone,
    }));
    const isCombined = members.length > 1;
    let finalPricing = (primary.finalPricing ?? null) as FactoryPricingResult | null;
    if (isCombined) {
      const priced = products.map((p) => p.finalPricing).filter((p): p is FactoryPricingResult => !!p);
      if (priced.length > 1) finalPricing = combineMembers(priced);
    }
    // newest updatedAt across members drives the deal's sort/recency
    const newest = members.reduce((a, b) => (+a.updatedAt > +b.updatedAt ? a : b));

    // Customer payment schedule for the deal: the primary's stored plan applied
    // to the deal's customer grand total (sum of each member's split-aware
    // display total — combined deals pay on the sum). Null when no plan stored.
    const storedPlan = (primary.paymentPlan ?? null) as StoredDealPlan | null;
    const dealGrandTotalExVat = r2(
      products.reduce((s, p) => s + (p.finalPricing ? memberDisplayTotalExVat(p.finalPricing) : 0), 0)
    );
    const paymentSchedule = storedPlan
      ? resolveDealSchedule(dealGrandTotalExVat, storedPlan)
      : null;

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
      paymentSchedule,
      paymentPlanLabel: planLabel(storedPlan),
      paymentPlanId: typeof storedPlan === "string" ? storedPlan : null,
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
    // Re-closing clears any "הסר מעסקאות" tombstone so the deal reappears.
    .set({ closedDealAt: new Date(), dealGroupId: groupId, dealRemovedAt: null, updatedAt: new Date() })
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
    commissionIls: numOrUndef(actuals.commissionIls),
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
    // Closing clears any "הסר מעסקאות" tombstone so the deal reappears.
    .set({
      closedDealAt: closed ? new Date() : null,
      ...(closed ? { dealRemovedAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(factoryQuoteRequests.id, id));
}

/**
 * "הסר מעסקאות" — reversible removal of a deal from the עסקאות tab. Clears
 * closed_deal_at on ALL members (single or combined) and unbinds the group, so
 * the underlying quote(s) stay in "הצעות מפעל" and can be re-closed later.
 *
 * Sets a persistent `deal_removed_at` tombstone so the deal disappears EVEN when
 * its lead is WON (the legacy auto-show path would otherwise re-pin it). Fully
 * reversible: "סגור עסקה" clears the tombstone and the deal comes back.
 *
 * Returns `stillWon` for backward compat with the caller — but it no longer
 * means the deal stays visible: the tombstone hides it regardless of WON.
 */
export async function removeDeal(primaryId: string): Promise<{ stillWon: boolean }> {
  const memberIds = await dealMemberIds(primaryId);
  await db
    .update(factoryQuoteRequests)
    .set({ closedDealAt: null, dealGroupId: null, dealRemovedAt: new Date(), updatedAt: new Date() })
    .where(inArray(factoryQuoteRequests.id, memberIds));

  const memberRows = await db
    .select({ sid: factoryQuoteRequests.manychatSubId })
    .from(factoryQuoteRequests)
    .where(inArray(factoryQuoteRequests.id, memberIds));
  const sids = [...new Set(memberRows.map((r) => (r.sid ?? "").trim()).filter(Boolean))];
  if (sids.length === 0) return { stillWon: false };
  const wonRows = await db
    .select({ stage: leads.pipelineStage })
    .from(leads)
    .where(inArray(leads.manychatSubId, sids));
  return { stillWon: wonRows.some((r) => r.stage === "WON") };
}

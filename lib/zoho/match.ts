/**
 * Match Zoho Books documents to a closed deal — the "משוך מ-Zoho" suggestions.
 *
 * Deterministic scoring, no LLM. The UI shows the ranked candidates and Eli
 * confirms — this only has to put the right doc near the top, not be perfect.
 *
 * Calibrated to how Eli's Zoho actually looks (probed 2026-07-22, org 929765814):
 *  - Customer invoices — INC-VAT (18%, every line); CRM plannedRevenue is EX-VAT,
 *    so scoring/fill use the ex-VAT equivalent (total / 1.18).
 *  - Factory payments are EXPENSES on "Cost of Goods Sold" (not vendor bills),
 *    in CNY/USD, with `customer_name` linked by the zoho-invoice skill and
 *    bcy_total already in ₪ at the booked rate. Often split 30%/70% → two docs.
 *  - Sales commissions are EXPENSES on "עמלות מכירה", customer-linked → offered
 *    as extra-cost lines (they're a real per-order cost).
 *  - Shipping/customs — expenses (or future bills) matched by keyword.
 */

import type { ZohoListedDoc } from "./client";
import { listZohoBills, listZohoExpenses, listZohoInvoices } from "./client";

/** Invoices carry 18% VAT on every line (zoho-invoice skill default). */
const VAT_FACTOR = 1.18;

export interface ZohoSuggestion extends ZohoListedDoc {
  score: number;
  /** Which actuals bucket this doc most likely fills. */
  bucket: "revenue" | "factory" | "shipping" | "other";
  /** For invoices: the EX-VAT ₪ amount that should land in the revenue field. */
  exVatIls?: number;
}

export interface DealForMatch {
  customerName: string | null;
  /** When the quote was sent/closed — anchor for the date window. */
  closedAt: string | null;
  plannedRevenueIls: number | null;
  plannedFactoryIls: number | null;
  plannedShippingIls: number | null;
}

/** Hebrew/latin-insensitive token overlap in [0,1]. */
function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/["'׳״.,()\-–_]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  const ta = norm(a);
  const tb = norm(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  let hits = 0;
  for (const t of ta) {
    if (tb.some((u) => u === t || u.includes(t) || t.includes(u))) hits += 1;
  }
  return hits / Math.max(ta.length, 1);
}

/** 1 at exact amount, →0 as the gap approaches 50%. */
function amountCloseness(expected: number | null, actual: number | null | undefined): number {
  if (!expected || !actual || expected <= 0 || actual <= 0) return 0;
  const gap = Math.abs(actual - expected) / expected;
  return Math.max(0, 1 - gap / 0.5);
}

/** 1 when the doc is 0–120 days after close, fading outside. */
function dateCloseness(closedAt: string | null, docDate: string): number {
  if (!closedAt || !docDate) return 0.3;
  const days = (Date.parse(docDate) - Date.parse(closedAt)) / 86_400_000;
  if (Number.isNaN(days)) return 0.3;
  if (days >= -14 && days <= 120) return 1;
  if (days > 120) return Math.max(0, 1 - (days - 120) / 120);
  return Math.max(0, 1 - (-14 - days) / 30);
}

const SHIPPING_RE = /שילוח|ספנות|עמיל|מכס|נמל|shipping|freight|sea|ocean|logist|יעדים|forward|customs/i;
const FACTORY_RE = /cost of goods|סחורה|מפעל|factory|יצרן/i;
const COMMISSION_RE = /עמל|commission/i;

function docText(d: ZohoListedDoc): string {
  return `${d.accountName ?? ""} ${d.description ?? ""} ${d.party} ${d.number}`;
}

export interface ZohoMatchResult {
  invoices: ZohoSuggestion[];
  factoryBills: ZohoSuggestion[];
  shippingDocs: ZohoSuggestion[];
  /** Commission + other customer-linked expenses → extra-cost lines. */
  otherDocs: ZohoSuggestion[];
}

/**
 * Rank recent Zoho docs against one deal. Fetches the three streams in
 * parallel; each bucket returns its top candidates (best first).
 */
export async function matchZohoDocsToDeal(deal: DealForMatch): Promise<ZohoMatchResult> {
  const [invoices, bills, expenses] = await Promise.all([
    listZohoInvoices(),
    listZohoBills(),
    listZohoExpenses(),
  ]);

  const name = deal.customerName ?? "";

  const inv: ZohoSuggestion[] = invoices
    .map((d) => {
      const exVat = d.totalIls != null ? d.totalIls / VAT_FACTOR : undefined;
      return {
        ...d,
        bucket: "revenue" as const,
        exVatIls: exVat,
        score:
          nameSimilarity(name, d.party) * 0.55 +
          amountCloseness(deal.plannedRevenueIls, exVat) * 0.35 +
          dateCloseness(deal.closedAt, d.date) * 0.1,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const isShipping = (d: ZohoListedDoc) => SHIPPING_RE.test(docText(d));
  const isFactory = (d: ZohoListedDoc) => FACTORY_RE.test(docText(d)) && !isShipping(d);
  const isCommission = (d: ZohoListedDoc) => COMMISSION_RE.test(`${d.accountName ?? ""}`);

  // Factory: COGS expenses (customer-linked!) + any non-shipping vendor bills.
  const factoryBills: ZohoSuggestion[] = [
    ...expenses.filter((d) => isFactory(d) && !isCommission(d)),
    ...bills.filter((d) => !isShipping(d)),
  ]
    .map((d) => ({
      ...d,
      bucket: "factory" as const,
      score:
        nameSimilarity(name, `${d.party} ${d.description ?? ""}`) * 0.5 +
        amountCloseness(deal.plannedFactoryIls, d.totalIls) * 0.3 +
        dateCloseness(deal.closedAt, d.date) * 0.2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const shippingDocs: ZohoSuggestion[] = [
    ...expenses.filter((d) => isShipping(d)),
    ...bills.filter((d) => isShipping(d)),
  ]
    .map((d) => ({
      ...d,
      bucket: "shipping" as const,
      score:
        nameSimilarity(name, `${d.party} ${d.description ?? ""}`) * 0.35 +
        amountCloseness(deal.plannedShippingIls, d.totalIls) * 0.4 +
        dateCloseness(deal.closedAt, d.date) * 0.25,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // Commissions and any other customer-linked expense → extra-cost lines.
  const otherDocs: ZohoSuggestion[] = expenses
    .filter((d) => isCommission(d) || (!!d.party && !isFactory(d) && !isShipping(d)))
    .map((d) => ({
      ...d,
      bucket: "other" as const,
      score:
        nameSimilarity(name, `${d.party} ${d.description ?? ""}`) * 0.75 +
        dateCloseness(deal.closedAt, d.date) * 0.25,
    }))
    .filter((d) => d.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return { invoices: inv, factoryBills, shippingDocs, otherDocs };
}

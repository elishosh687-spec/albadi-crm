/**
 * Match Zoho Books documents to a closed deal — the "משוך מ-Zoho" suggestions.
 *
 * Deterministic scoring, no LLM. The UI shows the ranked candidates and Eli
 * confirms — this only has to put the right doc near the top, not be perfect.
 *
 *  - invoice  → matched on customer-name similarity + amount ≈ planned revenue
 *  - bill     → amount ≈ planned factory cost (vendor is the Chinese factory,
 *               so the customer name is useless here) + date after close
 *  - expense/bill → amount ≈ planned shipping
 *
 * All comparisons in ₪ (client.ts pre-converts via live FX).
 */

import type { ZohoListedDoc } from "./client";
import { listZohoBills, listZohoExpenses, listZohoInvoices } from "./client";

export interface ZohoSuggestion extends ZohoListedDoc {
  score: number;
  /** Which actuals bucket this doc most likely fills. */
  bucket: "revenue" | "factory" | "shipping";
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
function amountCloseness(expected: number | null, actual: number | null): number {
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

const SHIPPING_HINTS = /שילוח|ספנות|עמיל|מכס|shipping|freight|sea|ocean|logist|יעדים|forward/i;

export interface ZohoMatchResult {
  invoices: ZohoSuggestion[];
  factoryBills: ZohoSuggestion[];
  shippingDocs: ZohoSuggestion[];
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

  const inv: ZohoSuggestion[] = invoices
    .map((d) => ({
      ...d,
      bucket: "revenue" as const,
      score:
        nameSimilarity(deal.customerName ?? "", d.party) * 0.55 +
        amountCloseness(deal.plannedRevenueIls, d.totalIls) * 0.35 +
        dateCloseness(deal.closedAt, d.date) * 0.1,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const isShippingDoc = (d: ZohoListedDoc) =>
    SHIPPING_HINTS.test(`${d.party} ${d.number}`);

  const factoryBills: ZohoSuggestion[] = bills
    .filter((d) => !isShippingDoc(d))
    .map((d) => ({
      ...d,
      bucket: "factory" as const,
      score:
        amountCloseness(deal.plannedFactoryIls, d.totalIls) * 0.7 +
        dateCloseness(deal.closedAt, d.date) * 0.3,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const shippingDocs: ZohoSuggestion[] = [...bills.filter(isShippingDoc), ...expenses]
    .map((d) => ({
      ...d,
      bucket: "shipping" as const,
      score:
        amountCloseness(deal.plannedShippingIls, d.totalIls) * 0.6 +
        dateCloseness(deal.closedAt, d.date) * 0.25 +
        (isShippingDoc(d) ? 0.15 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return { invoices: inv, factoryBills, shippingDocs };
}

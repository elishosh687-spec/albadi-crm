/**
 * Re-import factory quotes from the Feishu sheet.
 *
 * When a quote is deleted from the CRM the row is hard-deleted, but the Feishu
 * sheet keeps it. This scans the sheet and re-creates any quote whose
 * quotationNo (column B) is no longer in the DB — preserving that SAME
 * quotation number, plus the product spec (A..J) and the factory response
 * (K..R). The lead link is resolved by matching the customer name (column A)
 * to a lead; rows with no matching lead are reported, not imported (the schema
 * requires a lead).
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  readAllRows,
  readRow,
  findRowByQuotationNo,
  parseFactoryRequestRow,
  parseFactoryResponseRow,
  baseQuoteNo,
} from "@/lib/feishu/sheets";
import type { FactoryProductSpec } from "@/lib/factory/types";

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Build a full FactoryProductSpec from a parsed Feishu request row. */
function buildSpec(cells: (string | number | null)[]): FactoryProductSpec {
  const req = parseFactoryRequestRow(cells);
  return {
    description: req.description ?? "",
    material: req.material ?? "",
    widthCm: req.widthCm ?? 0,
    heightCm: req.heightCm ?? 0,
    depthCm: req.depthCm ?? 0,
    quantity: req.quantity ?? 0,
    printing: req.printing ?? "",
    finishing: req.finishing ?? "",
    ...(req.picUrl ? { picUrl: req.picUrl } : {}),
  };
}

/**
 * Normalize a customer/lead name for matching: strip apostrophe/geresh variants
 * (so "חג׳ג׳" == "חג'ג'" == "חגג"), drop RTL marks, collapse whitespace. The
 * sheet name and the lead name should be the same string, but punctuation and
 * invisible marks drift between Hebrew keyboards — this makes the match robust.
 */
function normName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['`´‘’׳״‎‏]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ImportFromFeishuResult {
  ok: true;
  scanned: number;
  withQuoteNo: number;
  imported: number;
  skippedExisting: number;
  unmatched: { quotationNo: string; customer: string }[];
}

export async function importFromFeishu(): Promise<ImportFromFeishuResult> {
  const rows = await readAllRows(500);

  // Quotation numbers already present in the DB — skip those (not deleted).
  const existing = await db
    .select({ q: factoryQuoteRequests.quotationNo })
    .from(factoryQuoteRequests);
  const existingNos = new Set(
    existing.map((r) => (r.q ?? "").trim()).filter(Boolean)
  );

  // Lead lookup by display name (the only client identifier the sheet carries).
  // Include ALL leads (not just active) and match on a normalized name.
  const leadRows = await db
    .select({ sid: leads.manychatSubId, name: leads.name })
    .from(leads);
  const leadByName = new Map<string, string>();
  for (const l of leadRows) {
    const key = normName(l.name ?? "");
    if (key && !leadByName.has(key)) leadByName.set(key, l.sid.trim());
  }

  let imported = 0;
  let skippedExisting = 0;
  let withQuoteNo = 0;
  const unmatched: { quotationNo: string; customer: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    const rawQuoteNo = String(cells[1] ?? "").trim();
    // Real quote numbers: alphanumeric ≥4, with an optional "-A" revision
    // suffix (e.g. "EVLGTP1G-A"). Skips headers/blanks.
    if (!/^[A-Z0-9]{4,}(-[A-Z0-9]+)?$/i.test(rawQuoteNo)) continue;
    withQuoteNo++;
    // Store/compare by the base number (without the revision suffix) so it
    // matches the original DB convention and doesn't duplicate.
    const quotationNo = baseQuoteNo(rawQuoteNo);
    if (existingNos.has(quotationNo)) {
      skippedExisting++;
      continue;
    }
    const customer = String(cells[0] ?? "").trim();
    const sid = customer ? leadByName.get(normName(customer)) : undefined;
    if (!sid) {
      unmatched.push({ quotationNo, customer });
      continue;
    }

    const resp = parseFactoryResponseRow(cells);
    const spec = buildSpec(cells);

    await db.insert(factoryQuoteRequests).values({
      id: `fq_${Date.now()}_${shortId()}`,
      manychatSubId: sid,
      quotationNo, // preserve the sheet's quote number
      productSpec: spec,
      factoryResponse: resp.hasResponse ? resp : null,
      factoryStatus: resp.hasResponse ? "received" : "pending",
      feishuRowIndex: String(i + 1),
    });
    existingNos.add(quotationNo);
    imported++;
  }

  return {
    ok: true,
    scanned: rows.length,
    withQuoteNo,
    imported,
    skippedExisting,
    unmatched,
  };
}

export interface AssignResult {
  ok: boolean;
  error?: string;
}

/**
 * Manually re-import a single quote from Feishu, attaching it to a lead the
 * user picked (used when name matching failed). Re-reads the sheet row by
 * quotationNo so we don't trust stale client data.
 */
export async function assignImportedQuote(
  quotationNo: string,
  leadSid: string
): Promise<AssignResult> {
  const qNo = quotationNo.trim();
  const sid = leadSid.trim();
  if (!qNo || !sid) return { ok: false, error: "missing_params" };

  const existing = await db
    .select({ id: factoryQuoteRequests.id })
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.quotationNo, qNo))
    .limit(1);
  if (existing.length > 0) return { ok: false, error: "already_exists" };

  const rowIndex = await findRowByQuotationNo(qNo);
  if (!rowIndex) return { ok: false, error: "not_in_sheet" };

  const cells = await readRow(rowIndex);
  const resp = parseFactoryResponseRow(cells);
  const spec = buildSpec(cells);

  await db.insert(factoryQuoteRequests).values({
    id: `fq_${Date.now()}_${shortId()}`,
    manychatSubId: sid,
    quotationNo: qNo,
    productSpec: spec,
    factoryResponse: resp.hasResponse ? resp : null,
    factoryStatus: resp.hasResponse ? "received" : "pending",
    feishuRowIndex: rowIndex,
  });
  return { ok: true };
}

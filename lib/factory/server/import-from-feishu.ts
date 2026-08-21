/**
 * Re-import factory quotes from the Feishu sheet.
 *
 * Two jobs, and the second was missing until 2026-08-21:
 *
 * 1. RECREATE a quote whose quotationNo (column B) is no longer in the DB —
 *    deleted from the CRM, still in the sheet. Preserves that same quotation
 *    number, the product spec (A..J) and the factory response (L..R).
 * 2. REFRESH a quote that IS in the DB. The factory edits rows after we read
 *    them — a corrected price, carton data filled in late — and the import
 *    button used to skip every known quotation number, so pressing it after a
 *    factory correction did nothing at all and looked broken. It now pulls the
 *    response again.
 *
 * What a refresh does NOT touch, deliberately:
 *   - `productSpec`. The sheet's request columns can fall out of alignment
 *     with the stored row, which would write a different quote's product into
 *     this one. What we sent the factory is ours; only their answer is theirs.
 *   - `finalPricing`. That is the number the customer was quoted. A changed
 *     cost is surfaced (`pricingStale`) so it can be recalculated on purpose,
 *     never silently.
 *
 * The lead link is resolved by matching the customer name (column A) to a
 * lead; rows with no matching lead are reported, not imported.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  readAllRows,
  readRow,
  findRowByQuotationNo,
  parseFactoryRequestRow,
  parseFactoryResponseRow,
  hasCartonMasterData,
  baseQuoteNo,
} from "@/lib/feishu/sheets";
import type { FactoryResponse } from "@/lib/factory/types";
import { extractFeishuFileToken, feishuImageToBlobUrl } from "@/lib/feishu/media";
import type { FactoryProductSpec } from "@/lib/factory/types";

/** If the spec has no URL image but the sheet row embeds one, pull it to Blob. */
async function withSheetImage(
  spec: FactoryProductSpec,
  cells: (string | number | null)[]
): Promise<FactoryProductSpec> {
  if (spec.picUrl) return spec;
  const token = extractFeishuFileToken(cells[3]);
  if (!token) return spec;
  const url = await feishuImageToBlobUrl(token);
  return url ? { ...spec, picUrl: url } : spec;
}

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
  /** Existing quotes whose factory answer changed in the sheet and was pulled. */
  refreshed: { quotationNo: string; note: string }[];
  /** Existing quotes already identical to the sheet — nothing to do. */
  unchanged: number;
  unmatched: { quotationNo: string; customer: string }[];
}

/** Fresh values win where present; anything Eli edited by hand survives. */
function mergeResponse(
  stored: FactoryResponse | null,
  fresh: Record<string, unknown>,
): { merged: FactoryResponse; changed: boolean } {
  const merged = { ...(stored ?? {}) } as Record<string, unknown>;
  let changed = false;
  for (const [k, v] of Object.entries(fresh)) {
    if (k === "hasResponse") continue;
    if (v === null || v === undefined || v === "") continue;
    if (merged[k] !== v) {
      merged[k] = v;
      changed = true;
    }
  }
  return { merged: merged as unknown as FactoryResponse, changed };
}

export async function importFromFeishu(): Promise<ImportFromFeishuResult> {
  const rows = await readAllRows(500);

  // Quotation numbers already present in the DB — skip those. A SOFT-DELETED
  // row must NOT block a re-import: deleting a quote and re-importing it from
  // Feishu is the documented recovery path (the screen literally offers it),
  // and without this filter the import silently reported "already exists" and
  // did nothing. Bug hit on VIHFR5BJ, 2026-08-11.
  const existing = await db
    .select({
      id: factoryQuoteRequests.id,
      q: factoryQuoteRequests.quotationNo,
      status: factoryQuoteRequests.factoryStatus,
      response: factoryQuoteRequests.factoryResponse,
    })
    .from(factoryQuoteRequests)
    .where(isNull(factoryQuoteRequests.deletedAt));
  const existingNos = new Set(
    existing.map((r) => (r.q ?? "").trim()).filter(Boolean)
  );
  const existingByNo = new Map(
    existing.filter((r) => r.q).map((r) => [(r.q as string).trim(), r]),
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
  let unchanged = 0;
  let withQuoteNo = 0;
  const refreshed: { quotationNo: string; note: string }[] = [];
  const unmatched: { quotationNo: string; customer: string }[] = [];

  // A quotation number can appear on SEVERAL sheet rows — the factory copies a
  // row to re-answer it, so LRFWPG8H sits on both 64 and 65, one blank and one
  // filled. Walking rows in order would let whichever came last win, which is
  // arbitrary. Pick per number, once: the row that actually carries an answer,
  // and among those the last (the factory's newest word).
  const bestRow = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const no = String(rows[i][1] ?? "").trim();
    if (!/^[A-Z0-9]{4,}(-[A-Z0-9]+)?$/i.test(no)) continue;
    const key = baseQuoteNo(no);
    const answered = parseFactoryResponseRow(rows[i]).hasResponse;
    const prev = bestRow.get(key);
    if (prev === undefined) { bestRow.set(key, i); continue; }
    const prevAnswered = parseFactoryResponseRow(rows[prev]).hasResponse;
    if (answered || !prevAnswered) bestRow.set(key, i);
  }

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
    // Only the chosen row for this number does the work.
    if (bestRow.get(quotationNo) !== i) { continue; }
    const known = existingByNo.get(quotationNo);
    if (known) {
      // Already in the CRM — re-read the factory's answer instead of skipping.
      const fresh = parseFactoryResponseRow(cells);
      if (!fresh.hasResponse) { unchanged++; continue; }
      const { merged, changed } = mergeResponse(
        known.response as FactoryResponse | null,
        fresh as unknown as Record<string, unknown>,
      );
      if (!changed) { unchanged++; continue; }

      // Same gate the refresh cron applies: a price without carton qty/weight/
      // CBM would ship-price on the 1-CBM floor, so the row stays pending until
      // the factory finishes filling it — while keeping what we did pull.
      const ready = hasCartonMasterData(merged);
      const isFinalized = known.status === "finalized";
      const nextStatus = isFinalized ? "finalized" : ready ? "received" : "pending";

      await db
        .update(factoryQuoteRequests)
        .set({
          factoryResponse: merged,
          factoryStatus: nextStatus,
          feishuRowIndex: String(i + 1),
          updatedAt: new Date(),
        })
        .where(eq(factoryQuoteRequests.id, known.id));

      refreshed.push({
        quotationNo,
        // A finalized quote keeps the price the customer already received —
        // saying so is the whole point, otherwise the cost quietly drifts away
        // from the quote.
        note: isFinalized
          ? "עודכן מהמפעל — התמחור שנשלח ללקוח לא שונה, צריך לחשב מחדש"
          : ready
            ? "עודכן מהמפעל"
            : "עודכן חלקית — חסרים נתוני קרטון, נשאר ממתין",
      });
      continue;
    }
    const customer = String(cells[0] ?? "").trim();
    const sid = customer ? leadByName.get(normName(customer)) : undefined;
    if (!sid) {
      unmatched.push({ quotationNo, customer });
      continue;
    }

    const resp = parseFactoryResponseRow(cells);
    const spec = await withSheetImage(buildSpec(cells), cells);

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
    refreshed,
    unchanged,
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

  // Same rule as the bulk import: a trashed quote doesn't own its number.
  const existing = await db
    .select({ id: factoryQuoteRequests.id })
    .from(factoryQuoteRequests)
    .where(
      and(
        eq(factoryQuoteRequests.quotationNo, qNo),
        isNull(factoryQuoteRequests.deletedAt)
      )
    )
    .limit(1);
  if (existing.length > 0) return { ok: false, error: "already_exists" };

  const rowIndex = await findRowByQuotationNo(qNo);
  if (!rowIndex) return { ok: false, error: "not_in_sheet" };

  const cells = await readRow(rowIndex);
  const resp = parseFactoryResponseRow(cells);
  const spec = await withSheetImage(buildSpec(cells), cells);

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

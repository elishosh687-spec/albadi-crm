/**
 * Live verification of a single factory quote against its Feishu row.
 *
 * Why: the auto-refresh (refresh.ts) stops re-reading a quote once it's
 * `received` with complete carton data — so a later factory edit to the row
 * (corrected CBM, swapped supplier, …) never reaches the CRM and the stored
 * snapshot goes stale. Before finalizing/sending, the operator needs a live
 * "is this still what the table says?" check — and a one-click pull if not.
 *
 * `verifyQuoteAgainstFeishu` is READ-ONLY (compares stored vs live row).
 * `forceRefreshSingleQuote` writes the live values into the stored response
 * regardless of status (live wins; stored only fills gaps).
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  readRow,
  parseFactoryResponseRow,
  findRowByQuotationNo,
} from "@/lib/feishu/sheets";
import type { FactoryResponse } from "@/lib/factory/types";

export interface FieldDiff {
  field: string;
  label: string;
  stored: string | number | null;
  live: string | number | null;
}

export interface VerifyResult {
  ok: true;
  /** false when the quote has no quotationNo / row to look up, or the row
   *  isn't found in the sheet → can't verify. */
  verifiable: boolean;
  found: boolean;
  rowIndex: string | null;
  stored: FactoryResponse | null;
  live: FactoryResponse | null;
  diffs: FieldDiff[];
  match: boolean;
  reason?: string;
}

const FIELDS: { key: keyof FactoryResponse; label: string; numeric: boolean }[] = [
  { key: "unitCostCny", label: "עלות יחידה (¥)", numeric: true },
  { key: "cartonQty", label: "יח׳ לקרטון", numeric: true },
  { key: "cartonLengthCm", label: "אורך קרטון", numeric: true },
  { key: "cartonWidthCm", label: "רוחב קרטון", numeric: true },
  { key: "cartonHeightCm", label: "גובה קרטון", numeric: true },
  { key: "cartonCbm", label: "CBM לקרטון", numeric: true },
  { key: "weightKg", label: "משקל קרטון (ק״ג)", numeric: true },
  { key: "supplier", label: "ספק", numeric: false },
];

function numEq(a: unknown, b: unknown): boolean {
  const x = typeof a === "number" ? a : NaN;
  const y = typeof b === "number" ? b : NaN;
  if (Number.isNaN(x) && Number.isNaN(y)) return true;
  return Math.abs(x - y) < 0.005;
}

async function readLiveRow(
  id: string
): Promise<
  | { ok: false; reason: string }
  | {
      ok: true;
      row: typeof factoryQuoteRequests.$inferSelect;
      rowIndex: string;
      live: ReturnType<typeof parseFactoryResponseRow>;
      found: boolean;
    }
> {
  const [row] = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.quotationNo && !row.feishuRowIndex) {
    return { ok: false, reason: "no_feishu_link" };
  }
  let rowIndex = row.feishuRowIndex ?? null;
  let found = false;
  if (row.quotationNo) {
    const re = await findRowByQuotationNo(row.quotationNo);
    if (re) {
      rowIndex = re;
      found = true;
    }
  }
  if (!rowIndex) return { ok: false, reason: "no_row_index" };
  const cells = await readRow(rowIndex);
  const live = parseFactoryResponseRow(cells);
  return { ok: true, row, rowIndex, live, found };
}

export async function verifyQuoteAgainstFeishu(id: string): Promise<VerifyResult> {
  const res = await readLiveRow(id);
  if (!res.ok) {
    return {
      ok: true,
      verifiable: false,
      found: false,
      rowIndex: null,
      stored: null,
      live: null,
      diffs: [],
      match: false,
      reason: res.reason,
    };
  }
  const stored = (res.row.factoryResponse as FactoryResponse | null) ?? null;
  const live = res.live as unknown as FactoryResponse;

  const diffs: FieldDiff[] = [];
  for (const f of FIELDS) {
    const s = (stored?.[f.key] ?? null) as string | number | null;
    const l = (live?.[f.key] ?? null) as string | number | null;
    const same = f.numeric ? numEq(s, l) : (s ?? "") === (l ?? "");
    // Only flag when the LIVE value is present and differs — a blank live cell
    // (factory cleared/never filled) shouldn't raise a false "stale" alarm.
    if (!same && l !== null && l !== "" && l !== undefined) {
      diffs.push({ field: String(f.key), label: f.label, stored: s, live: l });
    }
  }
  return {
    ok: true,
    verifiable: true,
    found: res.found,
    rowIndex: res.rowIndex,
    stored,
    live,
    diffs,
    match: diffs.length === 0,
  };
}

export async function forceRefreshSingleQuote(
  id: string
): Promise<{ ok: boolean; reason?: string; merged?: FactoryResponse }> {
  const res = await readLiveRow(id);
  if (!res.ok) return { ok: false, reason: res.reason };
  const live = res.live;
  if (!live.hasResponse) return { ok: false, reason: "empty_live_row" };
  const stored = (res.row.factoryResponse as FactoryResponse | null) ?? { unitCostCny: 0 };
  // LIVE wins (this is an explicit "pull the table's current truth"); stored
  // only fills a field the live row left blank.
  const pick = <T>(l: T | undefined | null, s: T | undefined | null): T | undefined =>
    l !== undefined && l !== null && (l as unknown) !== 0 ? l : (s ?? undefined);
  const merged: FactoryResponse = {
    unitCostCny: pick(live.unitCostCny, stored.unitCostCny) ?? 0,
    cartonQty: pick(live.cartonQty, stored.cartonQty),
    cartonLengthCm: pick(live.cartonLengthCm, stored.cartonLengthCm),
    cartonWidthCm: pick(live.cartonWidthCm, stored.cartonWidthCm),
    cartonHeightCm: pick(live.cartonHeightCm, stored.cartonHeightCm),
    cartonCbm: pick(live.cartonCbm, stored.cartonCbm),
    weightKg: pick(live.weightKg, stored.weightKg),
    supplier: pick(live.supplier, stored.supplier),
    notes: pick(live.notes, stored.notes),
    platePerColorCny: pick(live.platePerColorCny, stored.platePerColorCny),
  };
  await db
    .update(factoryQuoteRequests)
    .set({ factoryResponse: merged, feishuRowIndex: res.rowIndex, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));
  return { ok: true, merged };
}

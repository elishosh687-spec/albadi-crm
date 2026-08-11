/**
 * "רענן מהמפעל (כפוי)" — re-pull ONE quote's factory row even when it's already
 * finalized.
 *
 * `refreshFromFeishu` deliberately skips `finalized` rows so a scheduled sweep
 * can't silently overwrite a priced quote. But the factory does edit rows after
 * we've priced them (seen 2026-08-11: VIHFR5BJ went from "￥1.55 with Care Label
 * / ￥1.75 without" to a flat ￥1.75), and there was no way to pull that in.
 *
 * This is the manual, per-quote escape hatch. It updates `factory_response`
 * only — it deliberately does **NOT** re-price. `final_pricing` is what the
 * customer was quoted; silently re-deriving it from a changed cost would move a
 * number Eli already sent out. Instead we report the delta so he can decide.
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  findRowByQuotationNo,
  readRow,
  parseFactoryResponseRow,
} from "@/lib/feishu/sheets";
import type { FactoryResponse } from "@/lib/factory/types";

export interface ForceRefreshResult {
  ok: boolean;
  error?: string;
  quotationNo?: string;
  rowIndex?: number | string;
  /** Field-level changes, for the UI to show. */
  changes?: { field: string; from: unknown; to: unknown }[];
  /** True when the factory's unit cost moved — the priced quote is now stale. */
  costChanged?: boolean;
  pricingStale?: boolean;
}

const NUM_FIELDS: (keyof FactoryResponse)[] = [
  "unitCostCny",
  "cartonQty",
  "cartonLengthCm",
  "cartonWidthCm",
  "cartonHeightCm",
  "cartonCbm",
  "weightKg",
];
const STR_FIELDS: (keyof FactoryResponse)[] = ["supplier", "notes"];

export async function forceRefreshQuote(id: string): Promise<ForceRefreshResult> {
  const [row] = await db
    .select({
      id: factoryQuoteRequests.id,
      quotationNo: factoryQuoteRequests.quotationNo,
      stored: factoryQuoteRequests.factoryResponse,
      finalPricing: factoryQuoteRequests.finalPricing,
    })
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "quote_not_found" };
  if (!row.quotationNo) return { ok: false, error: "no_quotation_no" };

  let rowIndex: number | string | null;
  try {
    rowIndex = await findRowByQuotationNo(row.quotationNo);
  } catch (e) {
    return { ok: false, error: `feishu_lookup_failed: ${e instanceof Error ? e.message : e}` };
  }
  if (!rowIndex) {
    return { ok: false, error: "row_not_found_in_sheet", quotationNo: row.quotationNo };
  }

  const cells = await readRow(rowIndex);
  const fresh = parseFactoryResponseRow(cells as never);
  if (!fresh.hasResponse) {
    return {
      ok: false,
      error: "sheet_row_has_no_factory_data",
      quotationNo: row.quotationNo,
      rowIndex,
    };
  }

  const stored = (row.stored ?? null) as FactoryResponse | null;
  // Force semantics: the FRESH sheet value wins wherever it exists — that's the
  // whole point of the button. Stored only fills gaps the factory left blank.
  const merged: FactoryResponse = { ...(stored ?? { unitCostCny: 0 }) };
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const f of NUM_FIELDS) {
    const v = fresh[f as keyof typeof fresh] as number | undefined;
    if (v !== undefined && v !== null && Number.isFinite(v) && v !== 0) {
      if (stored?.[f] !== v) changes.push({ field: f, from: stored?.[f] ?? null, to: v });
      (merged as unknown as Record<string, unknown>)[f] = v;
    }
  }
  for (const f of STR_FIELDS) {
    const v = fresh[f as keyof typeof fresh] as string | undefined;
    if (v) {
      if (stored?.[f] !== v) changes.push({ field: f, from: stored?.[f] ?? null, to: v });
      (merged as unknown as Record<string, unknown>)[f] = v;
    }
  }

  await db
    .update(factoryQuoteRequests)
    .set({ factoryResponse: merged, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));

  const costChanged = changes.some((c) => c.field === "unitCostCny");
  return {
    ok: true,
    quotationNo: row.quotationNo,
    rowIndex,
    changes,
    costChanged,
    // A priced quote whose cost moved needs Eli's attention — we don't touch it.
    pricingStale: costChanged && row.finalPricing != null,
  };
}

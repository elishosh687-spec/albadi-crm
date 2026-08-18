/**
 * One-shot: re-read every factory_quote_request with a feishuRowIndex, re-parse
 * with the fixed column mapping (Feishu added `数量` at K, shifting every
 * factory field right by one), and MERGE into stored factoryResponse — fresh
 * wins where present, stored kept otherwise (preserves e.g. platePerColorCny
 * that was extracted before the shift and no longer lives in the sheet cell).
 *
 * finalPricing is intentionally NOT recomputed here. FinalizeModal recomputes
 * livePricing on every open from factoryResponse + config, so the audit UI
 * and any re-open will already show correct shipping/margin. The stale
 * finalPricing on the row is only used as a "last saved" snapshot and will be
 * overwritten the moment the operator re-saves.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/_reparse-after-col-shift.ts        # dry run
 *   DATABASE_URL=... npx tsx scripts/_reparse-after-col-shift.ts --go   # apply
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq, isNotNull } from "drizzle-orm";
import {
  readRow,
  parseFactoryResponseRow,
  findRowByQuotationNo,
} from "@/lib/feishu/sheets";
import type { FactoryResponse } from "@/lib/factory/types";

function pickNum(...vals: (number | undefined | null)[]): number | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== 0 && Number.isFinite(v)) return v;
  }
  return undefined;
}
function pickStr(...vals: (string | undefined | null)[]): string | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

async function main() {
  const apply = process.argv.includes("--go");
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      status: factoryQuoteRequests.factoryStatus,
      q: factoryQuoteRequests.quotationNo,
      idx: factoryQuoteRequests.feishuRowIndex,
      resp: factoryQuoteRequests.factoryResponse,
    })
    .from(factoryQuoteRequests)
    .where(isNotNull(factoryQuoteRequests.feishuRowIndex));

  let scanned = 0;
  let changed = 0;
  let cbmFixed = 0;
  let indexDrift = 0;
  let skippedNoQuote = 0;
  let skippedNotFound = 0;
  for (const r of rows) {
    if (!r.idx) continue;
    scanned++;
    try {
      // Safety: multiple DB rows can share a stale feishuRowIndex when the
      // operator inserts/deletes rows in Feishu (drift). Always re-locate by
      // quotationNo — same defence as refresh.ts. Skip rows without a
      // quotationNo (nothing to look up) or that no longer exist in the sheet.
      if (!r.q) {
        skippedNoQuote++;
        console.log(`? ${r.id.slice(-6)} idx=${r.idx} no quotationNo — skip`);
        continue;
      }
      const activeIdx = await findRowByQuotationNo(r.q);
      if (!activeIdx) {
        skippedNotFound++;
        console.log(`? ${r.q} idx=${r.idx} not in sheet — skip`);
        continue;
      }
      if (activeIdx !== r.idx) {
        indexDrift++;
        console.log(`↻ ${r.q} idx drift: stored=${r.idx} actual=${activeIdx}`);
      }
      const cells = await readRow(activeIdx);
      const fresh = parseFactoryResponseRow(cells);
      if (!fresh.hasResponse) {
        console.log(`= ${r.q ?? r.id.slice(-6)} idx=${r.idx} pending (K empty) — skip`);
        continue;
      }
      const s = (r.resp as FactoryResponse | null) ?? { unitCostCny: 0 };
      // Fresh-authoritative: the stored numeric fields are the whole reason we
      // ran this — some are misinterpreted (unitCost=5000 that's actually the
      // request quantity; weight=0.15 that's actually a CBM). Falling back to
      // them contaminates the merged row. Take fresh values as-is; only keep
      // platePerColorCny from stored (it's the only field that could be right
      // in DB and missing from the current sheet — factory writes it once and
      // sometimes doesn't leave the "RMB.../COL" text in the remark cell).
      const merged: FactoryResponse = {
        unitCostCny: fresh.unitCostCny ?? 0,
        cartonQty: fresh.cartonQty,
        cartonLengthCm: fresh.cartonLengthCm,
        cartonWidthCm: fresh.cartonWidthCm,
        cartonHeightCm: fresh.cartonHeightCm,
        cartonCbm: fresh.cartonCbm,
        weightKg: fresh.weightKg,
        supplier: fresh.supplier,
        notes: fresh.notes,
        platePerColorCny: pickNum(fresh.platePerColorCny, s.platePerColorCny),
      };
      const before = JSON.stringify(s);
      const after = JSON.stringify(merged);
      if (before === after) {
        console.log(`= ${r.q ?? r.id.slice(-6)} idx=${r.idx} no-change`);
        continue;
      }
      changed++;
      // CBM sanity: was it in a "cbm >> dims" state before, and is it now sane?
      const dimsCbm =
        (s.cartonLengthCm ?? 0) * (s.cartonWidthCm ?? 0) * (s.cartonHeightCm ?? 0) / 1e6;
      const beforeBad =
        dimsCbm > 0 &&
        (s.cartonCbm ?? 0) > 0 &&
        Math.abs((s.cartonCbm ?? 0) - dimsCbm) / dimsCbm > 0.25;
      const dimsCbmNew =
        (merged.cartonLengthCm ?? 0) *
        (merged.cartonWidthCm ?? 0) *
        (merged.cartonHeightCm ?? 0) /
        1e6;
      const afterBad =
        dimsCbmNew > 0 &&
        (merged.cartonCbm ?? 0) > 0 &&
        Math.abs((merged.cartonCbm ?? 0) - dimsCbmNew) / dimsCbmNew > 0.25;
      if (beforeBad && !afterBad) cbmFixed++;

      console.log(`~ ${r.q ?? r.id.slice(-6)} idx=${r.idx}${beforeBad && !afterBad ? " ⚠→✓" : ""}`);
      console.log(
        `  before: unitCost=¥${s.unitCostCny} qty/carton=${s.cartonQty} L×W×H=${s.cartonLengthCm}×${s.cartonWidthCm}×${s.cartonHeightCm} cbm=${s.cartonCbm} kg=${s.weightKg} supplier="${s.supplier ?? "—"}"`
      );
      console.log(
        `  after : unitCost=¥${merged.unitCostCny} qty/carton=${merged.cartonQty} L×W×H=${merged.cartonLengthCm}×${merged.cartonWidthCm}×${merged.cartonHeightCm} cbm=${merged.cartonCbm} kg=${merged.weightKg} supplier="${merged.supplier ?? "—"}"`
      );

      if (apply) {
        await db
          .update(factoryQuoteRequests)
          .set({
            factoryResponse: merged,
            feishuRowIndex: activeIdx,
            updatedAt: new Date(),
          })
          .where(eq(factoryQuoteRequests.id, r.id));
      }
    } catch (err) {
      console.warn(`! ${r.q ?? r.id} read failed:`, err);
    }
  }
  console.log(
    `\nscanned=${scanned} changed=${changed} cbm-mismatches-fixed=${cbmFixed} drift=${indexDrift} skipped-no-quote=${skippedNoQuote} skipped-not-found=${skippedNotFound} apply=${apply}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

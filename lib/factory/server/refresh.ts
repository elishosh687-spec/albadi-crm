/**
 * Shared refresh logic: scan pending factory_quote_requests, read matching
 * Feishu rows, flip to status='received' if filled. Used by:
 *   - POST /api/factory/refresh  (dashboard cookie)
 *   - GET  /api/factory/refresh  (Vercel cron, Bearer CRON_SECRET)
 *   - POST /api/widget/factory/refresh  (widget_token)
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import {
  readRow,
  parseFactoryResponseRow,
  findRowByQuotationNo,
  hasCartonMasterData,
} from "@/lib/feishu/sheets";
import { sendEliDM } from "@/lib/notify/eli";
import type { FactoryResponse } from "@/lib/factory/types";

/** Same merge logic as finalize.ts. Fresh wins for any field where it has a
 *  real value; stored is the fallback. Returns the merged response and whether
 *  anything actually changed. */
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
function mergeFactoryResponse(
  stored: FactoryResponse | null,
  fresh: ReturnType<typeof parseFactoryResponseRow>
): { merged: FactoryResponse; changed: boolean } {
  const s = stored ?? { unitCostCny: 0 };
  const merged: FactoryResponse = {
    unitCostCny: pickNum(fresh.unitCostCny, s.unitCostCny) ?? 0,
    cartonQty: pickNum(fresh.cartonQty, s.cartonQty),
    cartonLengthCm: pickNum(fresh.cartonLengthCm, s.cartonLengthCm),
    cartonWidthCm: pickNum(fresh.cartonWidthCm, s.cartonWidthCm),
    cartonHeightCm: pickNum(fresh.cartonHeightCm, s.cartonHeightCm),
    cartonCbm: pickNum(fresh.cartonCbm, s.cartonCbm),
    weightKg: pickNum(fresh.weightKg, s.weightKg),
    supplier: pickStr(fresh.supplier, s.supplier),
    notes: pickStr(fresh.notes, s.notes),
  };
  const changed = JSON.stringify(merged) !== JSON.stringify(s);
  return { merged, changed };
}

export interface RefreshResult {
  ok: true;
  scanned: number;
  updated: number;
  updates: { id: string; rowIndex: string | null }[];
  dmResults: { id: string; dmStatus: string }[];
}

// (helpers defined below; declared above for type narrowness)

export async function refreshFromFeishu(): Promise<RefreshResult> {
  // Scan both:
  //  - 'pending' rows (waiting for any factory response)
  //  - 'received' rows where carton data is still missing — the factory often
  //    fills unitCost (col K) first and the carton/weight (L..Q) later. If we
  //    only scanned 'pending', the late carton fill would be lost and finalize
  //    would price on partial data (totalCbm=0 / weight=0 ⇒ sea 1-CBM floor).
  const candidates = await db
    .select()
    .from(factoryQuoteRequests)
    .where(
      and(
        isNotNull(factoryQuoteRequests.feishuRowIndex),
        or(
          eq(factoryQuoteRequests.factoryStatus, "pending"),
          and(
            eq(factoryQuoteRequests.factoryStatus, "received"),
            // Backfill window: the row reached 'received' but the carton data
            // is still incomplete. Bail out via JSON path checks — anything
            // missing (jsonb path returns NULL) or zero counts as incomplete.
            sql`(
              (factory_response->>'cartonQty') IS NULL
              OR (factory_response->>'cartonQty')::numeric = 0
              OR (factory_response->>'weightKg') IS NULL
              OR (factory_response->>'weightKg')::numeric = 0
              OR (factory_response->>'cartonCbm') IS NULL
              OR (factory_response->>'cartonCbm')::numeric = 0
            )`
          )
        )
      )
    );

  let updated = 0;
  const updates: { id: string; rowIndex: string | null }[] = [];
  const transitioned: {
    id: string;
    manychatSubId: string;
    quotationNo: string | null;
    unitCostCny: number;
  }[] = [];

  for (const row of candidates) {
    if (!row.feishuRowIndex) continue;
    try {
      let activeIndex: string = row.feishuRowIndex;
      if (row.quotationNo) {
        const found = await findRowByQuotationNo(row.quotationNo);
        if (found && found !== row.feishuRowIndex) {
          console.log(
            `[factory/refresh] row index drifted: id=${row.id} quote=${row.quotationNo} stored=${row.feishuRowIndex} actual=${found}`
          );
          activeIndex = found;
        } else if (!found) {
          console.warn(
            `[factory/refresh] quote ${row.quotationNo} not found in sheet — using stored idx ${row.feishuRowIndex}`
          );
        }
      }
      const cells = await readRow(activeIndex);
      const parsed = parseFactoryResponseRow(cells);
      if (!parsed.hasResponse) continue;

      const wasPending = row.factoryStatus === "pending";
      // Merge fresh values over stored — fresh wins where present, stored kept
      // otherwise. Avoids clobbering an Eli-edited supplier or notes if any.
      const { merged, changed } = mergeFactoryResponse(
        (row.factoryResponse as FactoryResponse | null),
        parsed
      );

      // GATE: do NOT mark a quote 'received' until the factory has filled the
      // carton master data (qty + weight + CBM). The price (col K) alone is the
      // half-filled state that produced the under-charged TZYXNDEW quote: the
      // shipping would price on a 0-CBM / 0-kg shipment (1-CBM floor). While the
      // master data is missing we keep the row 'pending' so the cron keeps
      // re-checking — but we still persist any partial data we did pull, so it
      // accumulates toward completeness instead of being re-read every cycle.
      const masterReady = hasCartonMasterData(merged);

      if (wasPending && !masterReady) {
        // Stay pending. Only write if the partial response actually changed.
        if (changed) {
          await db
            .update(factoryQuoteRequests)
            .set({
              factoryResponse: merged,
              feishuRowIndex: activeIndex,
              updatedAt: new Date(),
            })
            .where(eq(factoryQuoteRequests.id, row.id));
          console.log(
            `[factory/refresh] ${row.quotationNo ?? row.id}: price present but carton master incomplete — kept pending (qty=${merged.cartonQty ?? "—"} kg=${merged.weightKg ?? "—"} cbm=${merged.cartonCbm ?? "—"})`
          );
        }
        continue;
      }

      // No transition + no change → don't bother writing.
      if (!wasPending && !changed) continue;

      // NOTE: we deliberately do NOT overwrite productSpec from the Feishu row
      // here. The sheet's request columns (A..J) can fall out of alignment with
      // the stored row (row drift, missing quotationNo), which would write a
      // *different* quote's product details into this one. The product spec
      // captured at creation is the trusted source; edit it manually in the
      // FinalizeModal if needed. Only the factory response (price/carton) is
      // synced from the sheet.
      await db
        .update(factoryQuoteRequests)
        .set({
          factoryStatus: "received", // safe to re-assert for already-received rows
          factoryResponse: merged,
          feishuRowIndex: activeIndex,
          updatedAt: new Date(),
        })
        .where(eq(factoryQuoteRequests.id, row.id));
      updated += 1;
      updates.push({ id: row.id, rowIndex: activeIndex });
      if (wasPending) {
        transitioned.push({
          id: row.id,
          manychatSubId: row.manychatSubId,
          quotationNo: row.quotationNo,
          unitCostCny: merged.unitCostCny,
        });
      }
    } catch (err) {
      console.warn(
        `[factory/refresh] readRow failed for id=${row.id} row=${row.feishuRowIndex}:`,
        err
      );
    }
  }

  const dmResults: { id: string; dmStatus: string }[] = [];
  for (const t of transitioned) {
    try {
      const [leadRow] = await db
        .select({ name: leads.name, phone: leads.phoneE164 })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${t.manychatSubId}`)
        .limit(1);
      const lines = [
        "🏭 תשובה חדשה מהמפעל",
        `לקוח: ${leadRow?.name ?? "—"} (${leadRow?.phone ?? "—"})`,
        `הצעה: ${t.quotationNo ?? t.id.slice(-6)}`,
        `עלות יחידה: ¥${t.unitCostCny}`,
        `קישור: https://albadi-crm.vercel.app/dashboard/v3/conversations?lead=${encodeURIComponent(t.manychatSubId)}`,
      ];
      const dmStatus = await sendEliDM(lines.join("\n"));
      dmResults.push({ id: t.id, dmStatus });
    } catch (err) {
      console.warn("[factory/refresh] notify Eli failed", err);
      dmResults.push({ id: t.id, dmStatus: "error" });
    }
  }

  // Surface the new "factory received" signal in GHL Tasks tab + flip
  // owner tag to eli_action. Lazy import to keep cold-start cheap.
  if (transitioned.length > 0) {
    try {
      const { reconcileGHLTasksForLead } = await import(
        "@/lib/ghl-tasks/reconcile"
      );
      for (const t of transitioned) {
        void reconcileGHLTasksForLead(t.manychatSubId);
      }
    } catch (e) {
      console.warn("[factory/refresh] ghl tasks reconcile failed", e);
    }
  }

  return { ok: true, scanned: candidates.length, updated, updates, dmResults };
}

/**
 * Shared refresh logic: scan pending factory_quote_requests, read matching
 * Feishu rows, flip to status='received' if filled. Used by:
 *   - POST /api/factory/refresh  (dashboard cookie)
 *   - GET  /api/factory/refresh  (Vercel cron, Bearer CRON_SECRET)
 *   - POST /api/widget/factory/refresh  (widget_token)
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  readRow,
  parseFactoryResponseRow,
  parseFactoryRequestRow,
  findRowByQuotationNo,
} from "@/lib/feishu/sheets";
import type { FactoryProductSpec } from "@/lib/factory/types";
import { sendEliDM } from "@/lib/notify/eli";

export interface RefreshResult {
  ok: true;
  scanned: number;
  updated: number;
  updates: { id: string; rowIndex: string | null }[];
  dmResults: { id: string; dmStatus: string }[];
}

export async function refreshFromFeishu(): Promise<RefreshResult> {
  const pending = await db
    .select()
    .from(factoryQuoteRequests)
    .where(
      and(
        eq(factoryQuoteRequests.factoryStatus, "pending"),
        isNotNull(factoryQuoteRequests.feishuRowIndex)
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

  for (const row of pending) {
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
      // Also pull the product side (A..J) from the table and merge any
      // non-empty values over the stored spec — so the operator sees the
      // table's current product details (dims/material/qty/...) in the
      // FinalizeModal, just like the price is pulled from the table.
      const reqParsed = parseFactoryRequestRow(cells);
      const mergedSpec: FactoryProductSpec = {
        ...(row.productSpec as FactoryProductSpec),
        ...reqParsed,
      };
      await db
        .update(factoryQuoteRequests)
        .set({
          factoryStatus: "received",
          factoryResponse: parsed,
          productSpec: mergedSpec,
          feishuRowIndex: activeIndex,
          updatedAt: new Date(),
        })
        .where(eq(factoryQuoteRequests.id, row.id));
      updated += 1;
      updates.push({ id: row.id, rowIndex: activeIndex });
      transitioned.push({
        id: row.id,
        manychatSubId: row.manychatSubId,
        quotationNo: row.quotationNo,
        unitCostCny: parsed.unitCostCny,
      });
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

  return { ok: true, scanned: pending.length, updated, updates, dmResults };
}

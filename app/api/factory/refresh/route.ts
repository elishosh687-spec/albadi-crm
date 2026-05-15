/**
 * Scans all `factory_quote_requests` with status='pending' that have a
 * `feishu_row_index`, reads the matching Feishu row, and if the factory has
 * filled J..R (unit cost > 0) flips the row to status='received' with the
 * parsed response. Sends Eli a WhatsApp DM for each transition.
 *
 * - POST: dashboard "🔄 רענן" button (cookie-auth via middleware).
 * - GET: Vercel cron every 5 min. Bearer-auth via CRON_SECRET (Vercel
 *   automatically attaches `Authorization: Bearer ${CRON_SECRET}` to its
 *   cron HTTP calls).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  readRow,
  parseFactoryResponseRow,
  findRowByQuotationNo,
} from "@/lib/feishu/sheets";
import { sendEliDM } from "@/lib/notify/eli";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RefreshResult {
  ok: true;
  scanned: number;
  updated: number;
  updates: { id: string; rowIndex: string | null }[];
}

async function handleRefresh(): Promise<RefreshResult> {
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
  // Collect transitions so we can DM Eli after the DB writes finish.
  const transitioned: {
    id: string;
    manychatSubId: string;
    quotationNo: string | null;
    unitCostCny: number;
  }[] = [];

  for (const row of pending) {
    if (!row.feishuRowIndex) continue;
    try {
      // Stored feishuRowIndex can drift if the operator deletes/inserts
      // rows manually. Re-locate by quotationNo (column B). Fall back to
      // the stored index if no match — preserves the original behavior.
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
      await db
        .update(factoryQuoteRequests)
        .set({
          factoryStatus: "received",
          factoryResponse: parsed,
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

  // DM Eli per transition. Non-fatal — sendEliDM already soft-fails.
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
      await sendEliDM(lines.join("\n"));
    } catch (err) {
      console.warn("[factory/refresh] notify Eli failed", err);
    }
  }

  return { ok: true, scanned: pending.length, updated, updates };
}

export async function POST() {
  const result = await handleRefresh();
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  // Vercel cron sets Authorization: Bearer <CRON_SECRET>. Reject anything
  // else when the secret is configured. If unset (local dev), allow.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const result = await handleRefresh();
  return NextResponse.json(result);
}

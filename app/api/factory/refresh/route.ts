/**
 * POST /api/factory/refresh
 *
 * Scans all `factory_quote_requests` with status='pending' that have a
 * `feishu_row_index`, reads the matching Feishu row, and if the factory has
 * filled J..R (unit cost > 0) flips the row to status='received' with the
 * parsed response.
 *
 * Auth: dashboard cookie (middleware).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { readRow, parseFactoryResponseRow } from "@/lib/feishu/sheets";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
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

  for (const row of pending) {
    if (!row.feishuRowIndex) continue;
    try {
      const cells = await readRow(row.feishuRowIndex);
      const parsed = parseFactoryResponseRow(cells);
      if (!parsed.hasResponse) continue;
      await db
        .update(factoryQuoteRequests)
        .set({
          factoryStatus: "received",
          factoryResponse: parsed,
          updatedAt: new Date(),
        })
        .where(eq(factoryQuoteRequests.id, row.id));
      updated += 1;
      updates.push({ id: row.id, rowIndex: row.feishuRowIndex });
    } catch (err) {
      console.warn(
        `[factory/refresh] readRow failed for id=${row.id} row=${row.feishuRowIndex}:`,
        err
      );
    }
  }

  return NextResponse.json({ ok: true, scanned: pending.length, updated, updates });
}

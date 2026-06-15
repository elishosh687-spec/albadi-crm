/**
 * GET /api/factory/audit-quotes?codes=1XM6TMED,15JQUZLK
 *
 * One-shot diagnostic for "why isn't this quotation syncing from Feishu?".
 * For each code:
 *   - Find DB row(s) in factory_quote_requests by quotationNo (case-insensitive)
 *   - Report id, factoryStatus, feishuRowIndex, createdAt/updatedAt
 *   - Look up the row in Feishu via findRowByQuotationNo (scans top 200)
 *   - Read both the stored row index AND the live-found row, show col B + the
 *     parsed factory response so we can see whether the factory actually
 *     filled K..R yet.
 *
 * Auth: Bearer BOT_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import {
  findRowByQuotationNo,
  readRow,
  parseFactoryResponseRow,
} from "@/lib/feishu/sheets";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function probeRow(rowIndex: string | null) {
  if (!rowIndex) return null;
  try {
    const cells = await readRow(rowIndex);
    return {
      rowIndex,
      colA_customer: cells[0] ?? null,
      colB_quotationNo: cells[1] ?? null,
      colI_finishing: cells[8] ?? null,
      parsedResponse: parseFactoryResponseRow(cells),
    };
  } catch (err) {
    return { rowIndex, error: String(err) };
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const codesParam = req.nextUrl.searchParams.get("codes") ?? "";
  const codes = codesParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (codes.length === 0) {
    return NextResponse.json(
      { error: "missing ?codes=AAA,BBB" },
      { status: 400 }
    );
  }

  const results = await Promise.all(
    codes.map(async (code) => {
      const dbRows = await db
        .select()
        .from(factoryQuoteRequests)
        .where(sql`upper(${factoryQuoteRequests.quotationNo}) = upper(${code})`);

      const liveRowIndex = await findRowByQuotationNo(code).catch(
        (err) => `error: ${String(err)}`
      );

      const dbInfo = dbRows.map((r) => ({
        id: r.id,
        manychatSubId: r.manychatSubId,
        quotationNo: r.quotationNo,
        factoryStatus: r.factoryStatus,
        feishuRowIndex: r.feishuRowIndex,
        hasFactoryResponse: r.factoryResponse !== null,
        hasFinalPricing: r.finalPricing !== null,
        sentToCustomerAt: r.sentToCustomerAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        productSpec_finishing:
          (r.productSpec as Record<string, unknown>)?.finishing ?? null,
      }));

      const stored = dbRows[0]?.feishuRowIndex ?? null;
      const liveStr = typeof liveRowIndex === "string" ? liveRowIndex : null;
      const drifted = !!stored && !!liveStr && stored !== liveStr;

      const probes = await Promise.all([
        probeRow(stored),
        drifted ? probeRow(liveStr) : Promise.resolve(null),
      ]);

      const diagnosis = (() => {
        if (dbRows.length === 0) return "not_in_db";
        const row = dbRows[0];
        if (row.factoryStatus !== "pending") {
          return `not_pending (status=${row.factoryStatus}) — refresh ignores this row`;
        }
        if (!row.feishuRowIndex) {
          return "pending_but_no_feishu_row_index — never appended to sheet";
        }
        if (!liveStr) {
          return "quotationNo not found in top 200 of sheet (col B) — row may have scrolled past or col B was edited";
        }
        const probeStored = probes[0];
        if (
          probeStored &&
          "parsedResponse" in probeStored &&
          probeStored.parsedResponse?.hasResponse === false
        ) {
          return "row found but unitCost (col K) is empty — factory hasn't answered yet";
        }
        return "looks_syncable — refresh should pick this up; check cron logs";
      })();

      return {
        code,
        diagnosis,
        db: dbInfo,
        feishu: {
          findByQuotationNo: liveRowIndex,
          drifted,
          atStoredIndex: probes[0],
          atLiveIndex: probes[1],
        },
      };
    })
  );

  return NextResponse.json({ ok: true, results });
}

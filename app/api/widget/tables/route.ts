/**
 * GET /api/widget/tables?tab=shipping|quotes|orders[&q=…]
 *
 * READ-ONLY view of the Feishu workbook, for the `albadi` skill — so "how much
 * CBM is in the shipping table" can be answered from any folder on Eli's Mac
 * without loading this project, its database, or its credentials.
 *
 * Read-only on purpose. A generic "write cell X" API is what overwrote two
 * unrelated suppliers on 2026-08-23: the row number meant something different
 * on the tab it landed on. Writes stay behind intent-level endpoints that
 * locate their own row.
 *
 * Values come back COMPUTED, not as formula text — the volume columns here are
 * formulas, and reporting a recomputation instead of what the sheet says
 * answers a different question than the one asked.
 *
 * Auth: widget token (same as the rest of /api/widget).
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { getTenantAccessToken, getFeishuBaseUrl } from "@/lib/feishu/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WORKBOOK = process.env.FEISHU_SHEET_TOKEN ?? "";

/** Named tabs. The skill never passes a raw sheet id — one less way to be wrong. */
const TABS = {
  quotes:   { id: "0VJakh", range: "A1:U220", label: "הצעות מחיר" },
  orders:   { id: "xEIUB8", range: "A1:AG199", label: "מעקב הזמנות" },
  shipping: { id: "eY9rmi", range: "A1:S60",  label: "משלוחים" },
} as const;

type TabKey = keyof typeof TABS;

/** Feishu cells arrive as strings, numbers, or rich-text/link/image arrays. */
function cellText(c: unknown): string {
  if (Array.isArray(c)) {
    return c
      .map((s) => (s as { text?: string })?.text ?? "")
      .join("")
      .trim();
  }
  return c === null || c === undefined ? "" : String(c).trim();
}
const cellNum = (c: unknown): number =>
  typeof c === "number" ? c : Number(String(cellText(c)).replace(/,/g, "")) || 0;

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!WORKBOOK) {
    return NextResponse.json({ ok: false, error: "FEISHU_SHEET_TOKEN not set" }, { status: 503 });
  }
  const url = new URL(req.url);
  const tab = (url.searchParams.get("tab") ?? "shipping") as TabKey;
  if (!TABS[tab]) {
    return NextResponse.json(
      { ok: false, error: `unknown tab "${tab}"`, allowed: Object.keys(TABS) },
      { status: 400 },
    );
  }
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const { id, range, label } = TABS[tab];
  const token = await getTenantAccessToken();
  const base = getFeishuBaseUrl();
  const resp = await fetch(
    `${base}/open-apis/sheets/v2/spreadsheets/${WORKBOOK}/values/${id}!${range}` +
      `?valueRenderOption=UnformattedValue`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  const json = (await resp.json()) as {
    code?: number;
    msg?: string;
    data?: { valueRange?: { values?: unknown[][] } };
  };
  if (json.code) {
    return NextResponse.json({ ok: false, error: `feishu ${json.code}: ${json.msg}` }, { status: 502 });
  }
  const grid = json.data?.valueRange?.values ?? [];

  if (tab === "shipping") return NextResponse.json(shipping(grid, label, q));
  return NextResponse.json(generic(grid, tab, label, q));
}

/**
 * The shipping tab, grouped the way it is actually used: one destination per
 * customer, because a customer with two quotes still gets one delivery.
 */
function shipping(grid: unknown[][], label: string, q: string) {
  const HEADER_ROWS = 6; // title + EN header + 中文 header
  const rows = grid
    .map((row, i) => ({
      row: i + 1,
      customer: cellText(row?.[0]),
      quotationNo: cellText(row?.[1]),
      quantity: cellNum(row?.[5]),
      cartons: cellNum(row?.[12]),
      weightKg: cellNum(row?.[13]),
      cbm: cellNum(row?.[14]),
      supplier: cellText(row?.[15]),
      mode: cellText(row?.[16]) || null,
      address: cellText(row?.[18]) || null,
    }))
    .filter((r) => r.row > HEADER_ROWS && r.customer && r.quotationNo)
    .filter((r) => !q || `${r.customer} ${r.quotationNo}`.toLowerCase().includes(q));

  const byMode = (pred: (m: string | null) => boolean) =>
    rows.filter((r) => pred(r.mode)).reduce((s, r) => s + r.cbm, 0);

  const dests = new Map<string, { customer: string; address: string | null; quotes: string[]; cartons: number; weightKg: number; cbm: number }>();
  for (const r of rows) {
    const key = r.customer;
    const d = dests.get(key) ?? { customer: r.customer, address: r.address, quotes: [], cartons: 0, weightKg: 0, cbm: 0 };
    d.quotes.push(r.quotationNo);
    d.cartons += r.cartons;
    d.weightKg += r.weightKg;
    d.cbm += r.cbm;
    d.address ??= r.address;
    dests.set(key, d);
  }

  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    ok: true,
    tab: "shipping",
    label,
    rows,
    totals: {
      cbm: round(rows.reduce((s, r) => s + r.cbm, 0)),
      // "no mode marked" is its own bucket, never folded into sea — three rows
      // carry no mode today and guessing would silently change the number.
      byAir: round(byMode((m) => /air/i.test(m ?? ""))),
      bySea: round(byMode((m) => /sea/i.test(m ?? ""))),
      unmarked: round(byMode((m) => !m)),
      cartons: rows.reduce((s, r) => s + r.cartons, 0),
      weightKg: rows.reduce((s, r) => s + r.weightKg, 0),
    },
    destinations: [...dests.values()]
      .map((d) => ({ ...d, cbm: round(d.cbm) }))
      .sort((a, b) => b.cbm - a.cbm),
  };
}

/** Quotes / order-follow: header row + matching rows, no interpretation. */
function generic(grid: unknown[][], tab: TabKey, label: string, q: string) {
  const headerIdx = grid.findIndex(
    (r) => cellText(r?.[0]) === "Customer" || cellText(r?.[0]) === "联系人",
  );
  const header = (grid[headerIdx] ?? []).map(cellText);
  const rows = grid
    .map((row, i) => ({ row: i + 1, cells: (row ?? []).map(cellText) }))
    .filter((r) => r.row > headerIdx + 1 && r.cells[0] && r.cells[1])
    .filter((r) => !q || r.cells.join(" ").toLowerCase().includes(q));
  return { ok: true, tab, label, header, count: rows.length, rows };
}

/**
 * "ALBADI ORDER FOLLOW" sheet — where generated files attach to a customer's
 * order row. Separate spreadsheet from the factory-quote sheet, so it takes its
 * own token/tab (FEISHU_FILES_SHEET_TOKEN / FEISHU_FILES_TAB_ID) and never
 * touches the code in sheets.ts.
 *
 * Layout (header row 5 EN / row 6 ZH, data from row 7):
 *   A Customer · B Quotation No. · C date · D Pic · … · X die line ·
 *   Y Grapgic (image) · Z Final Design
 *
 * File→column map (confirmed with Eli 2026-07-24) — the three production-stage
 * files of an order, all also saved to the local customer folder:
 *   X die line     ← factory_dieline : the BLANK dieline the factory first sends
 *   Y Grapgic      ← logo            : the logo the CUSTOMER sent
 *   Z Final Design ← dieline         : the FINAL production file (logo placed on
 *                                      the dieline — the dieline-print output)
 * Mockup/video (3D הדמיה) are pre-sale and have NO column here (skipped).
 * Invoice also has no column.
 */
import { feishuFetch } from "./client";

const DATA_START_ROW = 7;
const COL = { customer: 0, quotationNo: 1, factoryDieline: 23 /*X*/, logo: 24 /*Y*/, finalDesign: 25 /*Z*/ };
const KIND_COL: Record<string, number> = {
  factory_dieline: COL.factoryDieline, // X — blank factory template
  logo: COL.logo,                      // Y — customer's logo
  dieline: COL.finalDesign,            // Z — final production file (logo on dieline)
  final: COL.finalDesign,              // alias
};

function filesToken(): string {
  const t = process.env.FEISHU_FILES_SHEET_TOKEN;
  if (!t) throw new Error("FEISHU_FILES_SHEET_TOKEN not set");
  return t;
}
function filesTab(): string {
  const t = process.env.FEISHU_FILES_TAB_ID;
  if (!t) throw new Error("FEISHU_FILES_TAB_ID not set");
  return t;
}

/** Feishu cells can be a plain value or a rich-text segment array — flatten to text. */
function cellText(c: unknown): string {
  if (c == null) return "";
  if (Array.isArray(c)) return c.map((s) => (s as { text?: string })?.text ?? "").join("");
  return String(c);
}

function colLetter(n: number): string {
  let s = "";
  let x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

export interface OrderMatch { row: number; customer: string; quotationNo: string; }

/** Rows whose Customer (col A) matches the name (case-insensitive, either contains the other). */
export async function findOrderRows(customerName: string): Promise<OrderMatch[]> {
  const range = `${filesTab()}!A${DATA_START_ROW}:B400`;
  const resp = await feishuFetch<{ data?: { valueRange?: { values?: unknown[][] } } }>(
    `/open-apis/sheets/v2/spreadsheets/${filesToken()}/values/${encodeURIComponent(range)}`,
    { method: "GET" }
  );
  const rows = resp.data?.valueRange?.values ?? [];
  const q = customerName.trim().toLowerCase();
  const out: OrderMatch[] = [];
  rows.forEach((r, i) => {
    const cust = cellText(r?.[0]).trim();
    if (!cust) return;
    const lc = cust.toLowerCase();
    if (lc === q || lc.includes(q) || q.includes(lc)) {
      out.push({ row: DATA_START_ROW + i, customer: cust, quotationNo: cellText(r?.[1]).trim() });
    }
  });
  return out;
}

/** 1-based index of the last row with any Customer value (for appending). */
async function lastCustomerRow(): Promise<number> {
  const range = `${filesTab()}!A${DATA_START_ROW}:A400`;
  const resp = await feishuFetch<{ data?: { valueRange?: { values?: unknown[][] } } }>(
    `/open-apis/sheets/v2/spreadsheets/${filesToken()}/values/${encodeURIComponent(range)}`,
    { method: "GET" }
  );
  const rows = resp.data?.valueRange?.values ?? [];
  let last = DATA_START_ROW - 1;
  rows.forEach((r, i) => { if (cellText(r?.[0]).trim()) last = DATA_START_ROW + i; });
  return last;
}

async function putCell(colIdx: number, row: number, value: string): Promise<void> {
  const c = colLetter(colIdx);
  const range = `${filesTab()}!${c}${row}:${c}${row}`;
  await feishuFetch(`/open-apis/sheets/v2/spreadsheets/${filesToken()}/values`, {
    method: "PUT",
    body: JSON.stringify({ valueRange: { range, values: [[value]] } }),
  });
}

export interface OrderWriteResult {
  ok: boolean;
  /** Set when the customer has >1 order and no quotationNo was given — caller must ask which. */
  needQuotation?: { options: OrderMatch[] };
  row?: number;
  column?: string;
  appended?: boolean;
  skipped?: string;
}

/**
 * Attach a file URL to a customer's ORDER FOLLOW row.
 * - kind with no column (e.g. invoice) → skipped.
 * - customer with multiple orders + no quotationNo → needQuotation.
 * - no matching customer → append a new row with the name + file.
 */
export async function attachFileToOrder(
  customerName: string,
  kind: string,
  fileUrl: string,
  quotationNo?: string | null,
  appendIfMissing: boolean = true
): Promise<OrderWriteResult> {
  const col = KIND_COL[kind];
  if (col === undefined) return { ok: false, skipped: `no column for kind "${kind}"` };

  const matches = await findOrderRows(customerName);

  if (matches.length === 0) {
    // Pre-sale mockups (appendIfMissing=false) don't create a row — the customer
    // may not have an order yet, and we don't want to clutter ORDER FOLLOW.
    if (!appendIfMissing) return { ok: false, skipped: "עדיין אין שורת הזמנה ללקוח (הדמיה pre-sale) — לא נכתב לגיליון" };
    const row = (await lastCustomerRow()) + 1;
    await putCell(COL.customer, row, customerName);
    await putCell(col, row, fileUrl);
    return { ok: true, row, column: colLetter(col), appended: true };
  }

  let target = matches[0];
  if (matches.length > 1) {
    if (!quotationNo) return { ok: false, needQuotation: { options: matches } };
    const m = matches.find((x) => x.quotationNo === quotationNo.trim());
    if (!m) return { ok: false, needQuotation: { options: matches } };
    target = m;
  }
  await putCell(col, target.row, fileUrl);
  return { ok: true, row: target.row, column: colLetter(col) };
}

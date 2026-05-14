/**
 * Feishu Sheets v2 API wrapper — matches Albadi's "non-woven Quotation" sheet layout.
 *
 * Column layout (real sheet — header row 8 of the CSV):
 *   Eli fills A..I:
 *     A Customer | B Quotation# | C Pic | D Description | E Material | F Size
 *     G Printing | H Finishing | I Quantity
 *   Factory fills J..R:
 *     J Price¥  | K Carton Qty | L Length cm | M Width cm | N Height cm
 *     O CBM     | P Weight kg  | Q Supplier  | R Remark
 *
 * Spreadsheet token = the URL segment after `/sheets/`.
 *
 * Env:
 *   FEISHU_SHEET_TOKEN
 *   FEISHU_SHEET_TAB_ID  (optional; first tab used if absent)
 */

import { feishuFetch } from "./client";

export function getSpreadsheetToken(): string {
  const t = process.env.FEISHU_SHEET_TOKEN;
  if (!t) throw new Error("FEISHU_SHEET_TOKEN not set");
  return t;
}

interface MetaResp {
  data: {
    sheets: {
      sheet_id: string;
      title: string;
      index: number;
    }[];
  };
}

let sheetIdCache: string | null = null;

export async function getSheetId(): Promise<string> {
  const env = process.env.FEISHU_SHEET_TAB_ID;
  if (env) return env;
  if (sheetIdCache) return sheetIdCache;
  const token = getSpreadsheetToken();
  const meta = await feishuFetch<MetaResp>(
    `/open-apis/sheets/v3/spreadsheets/${token}/sheets/query`,
    { method: "GET" }
  );
  const first = meta.data?.sheets?.sort((a, b) => a.index - b.index)?.[0];
  if (!first) throw new Error("Feishu spreadsheet has no sheets");
  sheetIdCache = first.sheet_id;
  return first.sheet_id;
}

/**
 * Appends a row of values to the sheet. Returns the 1-based row index.
 */
export async function appendRow(values: (string | number)[]): Promise<string> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const range = `${sheetId}!A:I`;
  type AppendResp = {
    data: {
      updates: {
        updatedRange: string;
        updatedRows: number;
      };
    };
  };
  const resp = await feishuFetch<AppendResp>(
    `/open-apis/sheets/v2/spreadsheets/${token}/values_append?insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({
        valueRange: {
          range,
          values: [values],
        },
      }),
    }
  );
  const updated = resp.data?.updates?.updatedRange ?? "";
  const m = updated.match(/!([A-Z]+)(\d+):/);
  return m ? m[2] : "";
}

/**
 * Reads a single row across A..R. Returns the raw cell values (18 cells).
 */
export async function readRow(rowIndex: string | number): Promise<(string | number | null)[]> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const range = `${sheetId}!A${rowIndex}:R${rowIndex}`;
  type ReadResp = {
    data: {
      valueRange: {
        values: (string | number | null)[][];
      };
    };
  };
  const resp = await feishuFetch<ReadResp>(
    `/open-apis/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range)}`,
    { method: "GET" }
  );
  const rows = resp.data?.valueRange?.values ?? [];
  return rows[0] ?? [];
}

// ------------------------------------------------------------
// Request (Eli's side, A..I)
// ------------------------------------------------------------

export interface FactoryRequestColumns {
  customer: string;       // A
  quotationNo: string;    // B
  pic: string;            // C (URL or "")
  description: string;    // D
  material: string;       // E
  size: string;           // F  e.g. "H20*D8*W25"
  printing: string;       // G  e.g. "3 color(s)"
  finishing: string;      // H  e.g. "Handles / not laminated"
  quantity: number | string; // I
}

export function buildFactoryRow(cols: FactoryRequestColumns): (string | number)[] {
  return [
    cols.customer ?? "",
    cols.quotationNo ?? "",
    cols.pic ?? "",
    cols.description ?? "",
    cols.material ?? "",
    cols.size ?? "",
    cols.printing ?? "",
    cols.finishing ?? "",
    cols.quantity ?? "",
  ];
}

// ------------------------------------------------------------
// Response (factory's side, J..R = indices 9..17)
// ------------------------------------------------------------

export interface ParsedFactoryResponse {
  unitCostCny: number;
  cartonQty?: number;
  cartonLengthCm?: number;
  cartonWidthCm?: number;
  cartonHeightCm?: number;
  cartonCbm?: number;
  weightKg?: number;
  supplier?: string;
  notes?: string;
  hasResponse: boolean;
}

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  // Strip currency symbols like "￥" or "¥", keep digits + . + -
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function toStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

export function parseFactoryResponseRow(
  row: (string | number | null)[]
): ParsedFactoryResponse {
  // Indices 9..17 = columns J..R
  const unitCost = toNum(row[9]);
  const cartonQty = toNum(row[10]);
  const cartonLen = toNum(row[11]);
  const cartonWid = toNum(row[12]);
  const cartonHei = toNum(row[13]);
  let cartonCbm = toNum(row[14]);
  const weight = toNum(row[15]);
  const supplier = toStr(row[16]);
  const notes = toStr(row[17]);

  // If CBM not provided but dims are, derive: (L*W*H) cm / 1,000,000 = m³
  if (
    cartonCbm === undefined &&
    cartonLen !== undefined &&
    cartonWid !== undefined &&
    cartonHei !== undefined
  ) {
    cartonCbm = (cartonLen * cartonWid * cartonHei) / 1_000_000;
  }

  return {
    unitCostCny: unitCost ?? 0,
    cartonQty,
    cartonLengthCm: cartonLen,
    cartonWidthCm: cartonWid,
    cartonHeightCm: cartonHei,
    cartonCbm,
    weightKg: weight,
    supplier,
    notes,
    hasResponse: unitCost !== undefined && unitCost > 0,
  };
}

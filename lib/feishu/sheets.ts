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
  const range = `${sheetId}!A:J`;
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
 * Default height (px) applied to rows we append. Matches the existing
 * factory-side rows visually so the sheet looks consistent for the supplier.
 */
export const FEISHU_ROW_HEIGHT_PX = 70;

/**
 * Apply a date cell-format ("yyyy/MM/dd") to a single cell. Used after
 * append so the Excel-serial value written into column C renders as a
 * clickable date that opens Feishu's date picker, instead of as a raw
 * integer ("46164") or a text string.
 *
 * Feishu API: PUT /open-apis/sheets/v2/spreadsheets/{token}/style
 *   body.appendStyle.style.formatter = "yyyy/MM/dd"
 *
 * Non-fatal on failure — the cell still holds the serial value; only
 * the visual format is missing.
 */
export async function setCellDateFormat(
  rowIndex: string | number,
  columnLetter: string
): Promise<void> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const idx = typeof rowIndex === "string" ? parseInt(rowIndex, 10) : rowIndex;
  if (!Number.isFinite(idx) || idx <= 0) {
    throw new Error(`setCellDateFormat: invalid rowIndex=${rowIndex}`);
  }
  const range = `${sheetId}!${columnLetter}${idx}:${columnLetter}${idx}`;
  await feishuFetch(
    `/open-apis/sheets/v2/spreadsheets/${token}/style`,
    {
      method: "PUT",
      body: JSON.stringify({
        appendStyle: {
          range,
          style: {
            formatter: "yyyy/MM/dd",
          },
        },
      }),
    }
  );
}

/**
 * Write a value into a single cell (e.g. the Remark column S of a just-appended
 * request row). `appendRow` only writes A..J, so anything past J needs its own
 * targeted write. Non-fatal callers should wrap in try/catch.
 *
 * Feishu API: PUT /open-apis/sheets/v2/spreadsheets/{token}/values
 */
export async function setCellValue(
  rowIndex: string | number,
  columnLetter: string,
  value: string | number
): Promise<void> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const idx = typeof rowIndex === "string" ? parseInt(rowIndex, 10) : rowIndex;
  if (!Number.isFinite(idx) || idx <= 0) {
    throw new Error(`setCellValue: invalid rowIndex=${rowIndex}`);
  }
  const range = `${sheetId}!${columnLetter}${idx}:${columnLetter}${idx}`;
  await feishuFetch(`/open-apis/sheets/v2/spreadsheets/${token}/values`, {
    method: "PUT",
    body: JSON.stringify({ valueRange: { range, values: [[value]] } }),
  });
}

/**
 * Set the height (in pixels) of a specific row.
 *
 * Feishu API: PUT /open-apis/sheets/v2/spreadsheets/{token}/dimension_range
 * startIndex/endIndex are 1-based and inclusive; same value targets one row.
 */
export async function setRowHeight(
  rowIndex: string | number,
  pixels: number
): Promise<void> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const idx = typeof rowIndex === "string" ? parseInt(rowIndex, 10) : rowIndex;
  if (!Number.isFinite(idx) || idx <= 0) {
    throw new Error(`setRowHeight: invalid rowIndex=${rowIndex}`);
  }
  await feishuFetch(
    `/open-apis/sheets/v2/spreadsheets/${token}/dimension_range`,
    {
      method: "PUT",
      body: JSON.stringify({
        dimension: {
          sheetId,
          majorDimension: "ROWS",
          startIndex: idx,
          endIndex: idx,
        },
        dimensionProperties: { fixedSize: pixels },
      }),
    }
  );
}

/**
 * Reads a single row across A..T. Returns the raw cell values (20 cells).
 * Column T carries the factory-supplied plate fee ("plant fee" / 版费) —
 * factory writes free-text like `printing cost: RMB505/COL` which
 * parseFactoryResponseRow extracts to platePerColorCny.
 */
export async function readRow(rowIndex: string | number): Promise<(string | number | null)[]> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const range = `${sheetId}!A${rowIndex}:T${rowIndex}`;
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

/**
 * Find the actual row index of a quotation by searching column B. Used at
 * refresh time because stored feishuRowIndex can drift when the operator
 * deletes/inserts rows in Feishu. Returns null if not found.
 *
 * Scans A1:B{maxRows} once and looks for an exact match on column B.
 */
/**
 * Strip a trailing revision suffix ("-A", "-B", "-12") that the factory/sheet
 * appends to the quotation number, so "EVLGTP1G-A" matches the stored
 * "EVLGTP1G". Quote numbers themselves never contain a hyphen.
 */
export function baseQuoteNo(s: string): string {
  return s.trim().replace(/-[A-Za-z0-9]+$/, "");
}

export async function findRowByQuotationNo(
  quotationNo: string,
  maxRows = 200
): Promise<string | null> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const range = `${sheetId}!A1:B${maxRows}`;
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
  const needle = baseQuoteNo(quotationNo);
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i][1];
    if (b !== null && b !== undefined && baseQuoteNo(String(b)) === needle) {
      return String(i + 1); // 1-based row index
    }
  }
  return null;
}

/**
 * Read the full A..R grid (all columns, up to `maxRows`). Used by the
 * "import from Feishu" flow to re-create quotes that were deleted from the DB
 * but still exist in the sheet. Index in the returned array maps to 0-based
 * row; the 1-based Feishu row index is `i + 1`.
 */
export async function readAllRows(
  maxRows = 300
): Promise<(string | number | null)[][]> {
  const token = getSpreadsheetToken();
  const sheetId = await getSheetId();
  const range = `${sheetId}!A1:R${maxRows}`;
  type ReadResp = {
    data: { valueRange: { values: (string | number | null)[][] } };
  };
  const resp = await feishuFetch<ReadResp>(
    `/open-apis/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range)}`,
    { method: "GET" }
  );
  return resp.data?.valueRange?.values ?? [];
}

// ------------------------------------------------------------
// Request (Eli's side, A..J — column C is the creation date which Feishu
// auto-fills with a formula. We write it explicitly so the column never
// collapses if the formula is removed.)
// ------------------------------------------------------------

export interface FactoryRequestColumns {
  customer: string;       // A
  quotationNo: string;    // B
                          // C = date (auto, added by buildFactoryRow)
  pic: string;            // D (URL or "")
  description: string;    // E
  material: string;       // F
  size: string;           // G  e.g. "H20*D8*W25"
  printing: string;       // H  e.g. "3 color(s)"
  finishing: string;      // I  e.g. "Handles / not laminated"
  quantity: number | string; // J
}

/**
 * Today's date as an Excel-style serial number (days since 1899-12-30).
 * Sent as a number so Feishu's cell-format system recognizes it as a date
 * value — combined with `setCellDateFormat()` on column C right after the
 * append, the cell becomes a real date type that opens the date picker
 * when clicked. Sending a literal "YYYY-MM-DD" string would render as
 * text and lose the date picker; sending a number without the style call
 * would render as the raw integer (e.g. "46164").
 */
function todayExcelSerial(): number {
  const epoch = Date.UTC(1899, 11, 30); // Excel epoch (1899-12-30 UTC).
  const now = Date.now();
  return Math.floor((now - epoch) / 86_400_000);
}

export function buildFactoryRow(cols: FactoryRequestColumns): (string | number)[] {
  return [
    cols.customer ?? "",
    cols.quotationNo ?? "",
    todayExcelSerial(),
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
  /** Plate ("plant") fee per print colour in CNY. Extracted from column T of
   *  the quote sheet, where the factory writes free-text like
   *  `printing cost: RMB505/COL`. Undefined = factory didn't quote a plate
   *  fee for this row (typical for non-laminated printing). */
  platePerColorCny?: number;
  hasResponse: boolean;
}

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  // Strip currency symbols like "￥" or "¥", keep digits + . + -
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Feishu rich-text cells come back as arrays of segment objects:
 *   [{ segmentStyle: {...}, text: "With handles / ", type: "text" },
 *    { segmentStyle: {...}, text: "laminated",      type: "text" }]
 * Default String() coercion gives "[object Object],[object Object]" — useless.
 * Concatenate the `.text` from each segment instead. Returns null if the value
 * isn't a recognized rich-text shape so the caller falls back to String().
 */
function richTextToPlain(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  let out = "";
  for (const seg of v) {
    if (seg && typeof seg === "object" && "text" in seg && typeof (seg as { text: unknown }).text === "string") {
      out += (seg as { text: string }).text;
    } else {
      // Mixed/unknown shape — bail to default coercion.
      return null;
    }
  }
  return out;
}

function toStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const rich = richTextToPlain(v);
  const s = (rich ?? String(v)).trim();
  return s ? s : undefined;
}

export function parseFactoryResponseRow(
  row: (string | number | null)[]
): ParsedFactoryResponse {
  // Sheet layout (current): the Feishu sheet auto-fills column C with the
  // creation date, shifting every other column one slot to the right vs the
  // original assumption. Outgoing columns are now A,B,(C=date),D..J — see
  // appendRow comment. Incoming (factory's) columns are K..T:
  //   K(10) unitCost CNY, L(11) cartonQty, M(12) length, N(13) width,
  //   O(14) height, P(15) cbm, Q(16) weight, R(17) supplier,
  //   S(18) remark, T(19) plant fee (per-colour, e.g. "printing cost: RMB505/COL").
  const unitCost = toNum(row[10]);
  const cartonQty = toNum(row[11]);
  const cartonLen = toNum(row[12]);
  const cartonWid = toNum(row[13]);
  const cartonHei = toNum(row[14]);
  let cartonCbm = toNum(row[15]);
  const weight = toNum(row[16]);
  const supplier = toStr(row[17]);
  const notes: string | undefined = toStr(row[18]);
  // Column T = plate fee per colour. Factory writes free-text; parse the
  // first RMB<number>/COL match. Also accepts "¥<n>/color" as a fallback.
  const plateRaw = toStr(row[19]);
  let platePerColorCny: number | undefined;
  if (plateRaw) {
    const m = plateRaw.match(/(?:RMB|¥|￥)\s*([\d.]+)\s*\/\s*(?:COL|COLOR|צבע)/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0) platePerColorCny = n;
    }
  }

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
    platePerColorCny,
    hasResponse: unitCost !== undefined && unitCost > 0,
  };
}

/**
 * Does this factory response carry the carton "master data" needed to price
 * shipping correctly? Pricing needs:
 *   - cartonQty   → totalCartons = ceil(quantity / cartonQty); 0 ⇒ everything 0
 *   - weightKg    → air shipping is billed per kg
 *   - a real CBM  → sea shipping is billed per CBM (1-CBM floor if 0)
 * We require all three so neither sea nor air can fall back to the floor /
 * zero. The price (col K) alone is NOT enough — that's exactly the half-filled
 * state that produced the under-charged TZYXNDEW quote.
 */
export function hasCartonMasterData(r: {
  cartonQty?: number;
  weightKg?: number;
  cartonCbm?: number;
}): boolean {
  return (
    (r.cartonQty ?? 0) > 0 &&
    (r.weightKg ?? 0) > 0 &&
    (r.cartonCbm ?? 0) > 0
  );
}

// ------------------------------------------------------------
// Request (operator/product side, A..J = indices 0..9, C=date at index 2)
// ------------------------------------------------------------

/** Parse the "H{h}*D{d}*W{w}" size label written by buildFactoryRow back into
 *  cm dimensions. Tolerates missing parts and either `*` or `×` separators. */
export function parseSizeLabel(s: string): {
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
} {
  const out: { widthCm?: number; heightCm?: number; depthCm?: number } = {};
  const h = s.match(/H\s*([\d.]+)/i);
  const d = s.match(/D\s*([\d.]+)/i);
  const w = s.match(/W\s*([\d.]+)/i);
  if (h) out.heightCm = parseFloat(h[1]);
  if (d) out.depthCm = parseFloat(d[1]);
  if (w) out.widthCm = parseFloat(w[1]);
  return out;
}

export interface ParsedFactoryRequest {
  picUrl?: string;
  description?: string;
  material?: string;
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
  printing?: string;
  finishing?: string;
  quantity?: number;
}

/** Parse the operator/product side of a Feishu row (A..J, indices 0..9 with
 *  C=date at index 2). Only returns fields that are actually present, so a
 *  caller can safely merge non-empty values over an existing spec without
 *  clobbering it with blanks. */
export function parseFactoryRequestRow(
  row: (string | number | null)[]
): ParsedFactoryRequest {
  const out: ParsedFactoryRequest = {};
  const picUrl = toStr(row[3]);
  const description = toStr(row[4]);
  const material = toStr(row[5]);
  const size = toStr(row[6]);
  const printing = toStr(row[7]);
  const finishing = toStr(row[8]);
  const quantity = toNum(row[9]);
  // Only a real URL — embedded-image cells come back as an object (handled
  // separately by the media downloader), not a usable string here.
  if (picUrl && /^https?:\/\//i.test(picUrl)) out.picUrl = picUrl;
  if (description) out.description = description;
  if (material) out.material = material;
  if (size) {
    const dims = parseSizeLabel(size);
    if (dims.widthCm !== undefined) out.widthCm = dims.widthCm;
    if (dims.heightCm !== undefined) out.heightCm = dims.heightCm;
    if (dims.depthCm !== undefined) out.depthCm = dims.depthCm;
  }
  if (printing) out.printing = printing;
  if (finishing) out.finishing = finishing;
  if (quantity !== undefined) out.quantity = quantity;
  return out;
}

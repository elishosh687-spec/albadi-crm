/**
 * Read the FB lead-form Google Sheet and surface rows that did NOT make it
 * to the CRM as proper leads. Used by the dashboard "פערי טופס" pill and by
 * the followups cron to DM Eli.
 *
 * Auth: none — Sheet must be "Anyone with link can view".
 * Reads via CSV export URL (no googleapis, no service account needed).
 *
 * Soft-fail contract: missing env or fetch error returns an empty snapshot
 * (total=0). NEVER throws — both the dashboard and the cron rely on this.
 */

export interface SheetGapRow {
  rowIndex: number; // 1-based, matches Sheet row number
  name: string | null;
  rawPhone: string | null;
  sentAt: string | null;
  lastStatus: string | null;
  sid: string | null;
  category: "pending" | "bad_phone" | "send_failed" | "other_error";
}

export interface SheetGapSnapshot {
  total: number;
  pendingCount: number;
  badPhoneCount: number;
  sendFailedCount: number;
  otherErrorCount: number;
  oldestPendingAt: Date | null;
  rows: SheetGapRow[];
  fetchedAt: Date;
  spreadsheetId: string | null;
}

const EMPTY_SNAPSHOT = (): SheetGapSnapshot => ({
  total: 0,
  pendingCount: 0,
  badPhoneCount: 0,
  sendFailedCount: 0,
  otherErrorCount: 0,
  oldestPendingAt: null,
  rows: [],
  fetchedAt: new Date(),
  spreadsheetId: null,
});

// 5-minute module-level cache — repeated page nav and cron ticks don't
// hammer the public CSV endpoint.
let cache: { at: number; snap: SheetGapSnapshot } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const COL_NAME = 12;
const COL_PHONE = 13;
const COL_SENT = 18;
const COL_LAST_STATUS = 19;
const COL_SID = 20;

function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith("﻿") ? raw.slice(1) : raw;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function classifyRow(
  lastStatus: string | null,
  sent: string | null
): SheetGapRow["category"] | null {
  const ls = (lastStatus ?? "").trim();
  const isSent = (sent ?? "").trim().toUpperCase() === "SENT";
  if (ls.startsWith("BAD_PHONE")) return "bad_phone";
  if (ls === "lead_created_send_failed") return "send_failed";
  if (ls.startsWith("http_") || ls.startsWith("exception_")) return "other_error";
  if (isSent) return null; // happy path — not a gap
  return "pending";
}

export async function loadSheetGaps(
  opts: { force?: boolean } = {}
): Promise<SheetGapSnapshot> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.snap;
  }

  const spreadsheetId = readEnv("GOOGLE_SHEETS_FB_LEADS_ID").trim();

  if (!spreadsheetId) {
    console.warn("[sheets.lead-gaps] missing GOOGLE_SHEETS_FB_LEADS_ID — returning empty snapshot");
    const empty = EMPTY_SNAPSHOT();
    cache = { at: Date.now(), snap: empty };
    return empty;
  }

  try {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
    const resp = await fetch(url, { redirect: "follow" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const lines = text.split(/\r?\n/);

    const rows: SheetGapRow[] = [];
    let pendingCount = 0;
    let badPhoneCount = 0;
    let sendFailedCount = 0;
    let otherErrorCount = 0;

    // Skip header row (index 0).
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const r = parseCSVLine(line);
      const name = (r[COL_NAME] ?? "").trim() || null;
      const rawPhone = (r[COL_PHONE] ?? "").trim() || null;
      const sent = (r[COL_SENT] ?? "").trim() || null;
      const lastStatus = (r[COL_LAST_STATUS] ?? "").trim() || null;
      const sid = (r[COL_SID] ?? "").trim() || null;

      if (!name || !rawPhone) continue;
      if (rawPhone.indexOf("test lead") !== -1) continue;

      const category = classifyRow(lastStatus, sent);
      if (!category) continue;

      switch (category) {
        case "pending": pendingCount++; break;
        case "bad_phone": badPhoneCount++; break;
        case "send_failed": sendFailedCount++; break;
        case "other_error": otherErrorCount++; break;
      }

      rows.push({
        rowIndex: i + 1,
        name,
        rawPhone,
        sentAt: sent,
        lastStatus,
        sid,
        category,
      });
    }

    const snap: SheetGapSnapshot = {
      total: rows.length,
      pendingCount,
      badPhoneCount,
      sendFailedCount,
      otherErrorCount,
      oldestPendingAt: null,
      rows,
      fetchedAt: new Date(),
      spreadsheetId,
    };
    cache = { at: Date.now(), snap };
    return snap;
  } catch (e) {
    console.warn("[sheets.lead-gaps] fetch failed — returning empty snapshot", e);
    const empty = EMPTY_SNAPSHOT();
    empty.spreadsheetId = spreadsheetId;
    cache = { at: Date.now(), snap: empty };
    return empty;
  }
}

export function sheetRowDeepLink(spreadsheetId: string | null, rowIndex: number): string | null {
  if (!spreadsheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0&range=A${rowIndex}`;
}

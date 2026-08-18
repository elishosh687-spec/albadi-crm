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
import { resolveFbFormColumns } from "@/lib/sheets/fb-form-columns";
import { metaSheetIds } from "@/lib/sheets/meta-attribution";

export interface SheetGapRow {
  rowIndex: number; // 1-based, matches Sheet row number
  spreadsheetId: string; // which sheet this row came from — deep links need it
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

/**
 * Column positions are resolved from the HEADER ROW, not hardcoded.
 *
 * Adding a question to the Instant Form inserts a column and shifts every
 * field after it. Reading `phone` from a fixed index 13 then silently returns
 * an answer instead of a number, and this panel — the one whose whole job is
 * to catch leads that fell through — becomes the thing that hides them.
 *
 * The Apps Script's own three columns (SENT / status / sid) have blank headers
 * today, so they still fall back to 18/19/20. Give them real headers in the
 * sheet (`crm_sent` / `crm_status` / `crm_sid`) and they become shift-proof
 * too. See lib/sheets/fb-form-columns.ts.
 */
const MARKER_HEADERS: Record<string, { names: string[]; fallback: number }> = {
  sent: { names: ["crm_sent", "sent"], fallback: 18 },
  status: { names: ["crm_status", "status", "last_status"], fallback: 19 },
  sid: { names: ["crm_sid", "sid"], fallback: 20 },
};

interface GapCols {
  name: number;
  phone: number;
  sent: number;
  status: number;
  sid: number;
}

function resolveGapCols(header: string[]): GapCols {
  const base = resolveFbFormColumns(header);
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "_");
  const normalised = header.map(norm);
  const marker = (key: keyof typeof MARKER_HEADERS) => {
    const { names, fallback } = MARKER_HEADERS[key];
    const found = normalised.findIndex((h) => names.some((n) => norm(n) === h));
    return found >= 0 ? found : fallback;
  };
  return {
    name: base.idx.fullName ?? 12,
    phone: base.idx.phone ?? 13,
    sent: marker("sent"),
    status: marker("status"),
    sid: marker("sid"),
  };
}

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

  // Read EVERY known form sheet, not just the one in the env var. A live form
  // gets its own spreadsheet (Meta writes each form's answers in that form's
  // own field order, so two forms cannot share one sheet), and this panel's
  // whole job is spotting leads that fell through — pointing it at a single
  // sheet makes it blind to the newest form, which is precisely the one whose
  // rows nobody has eyeballed yet. Shares the id list with the attribution
  // pass so a sheet can never be registered in one place and missing here.
  const sheetIds = metaSheetIds();

  if (sheetIds.length === 0) {
    console.warn("[sheets.lead-gaps] no sheet ids — returning empty snapshot");
    const empty = EMPTY_SNAPSHOT();
    cache = { at: Date.now(), snap: empty };
    return empty;
  }

  const primaryId = readEnv("GOOGLE_SHEETS_FB_LEADS_ID").trim() || sheetIds[0];

  try {
    const rows: SheetGapRow[] = [];
    let pendingCount = 0;
    let badPhoneCount = 0;
    let sendFailedCount = 0;
    let otherErrorCount = 0;

    for (const spreadsheetId of sheetIds) {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
    const resp = await fetch(url, { redirect: "follow" });
    // One unreadable sheet must not blank the whole panel.
    if (!resp.ok) {
      console.warn(`[sheets.lead-gaps] ${spreadsheetId}: HTTP ${resp.status} — skipped`);
      continue;
    }
    const text = await resp.text();
    const lines = text.split(/\r?\n/);

    const COL = resolveGapCols(parseCSVLine(lines[0] ?? ""));
    // Skip header row (index 0).
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const r = parseCSVLine(line);
      const name = (r[COL.name] ?? "").trim() || null;
      const rawPhone = (r[COL.phone] ?? "").trim() || null;
      const sent = (r[COL.sent] ?? "").trim() || null;
      const lastStatus = (r[COL.status] ?? "").trim() || null;
      const sid = (r[COL.sid] ?? "").trim() || null;

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
        spreadsheetId,
        name,
        rawPhone,
        sentAt: sent,
        lastStatus,
        sid,
        category,
      });
    }
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
      spreadsheetId: primaryId,
    };
    cache = { at: Date.now(), snap };
    return snap;
  } catch (e) {
    console.warn("[sheets.lead-gaps] fetch failed — returning empty snapshot", e);
    const empty = EMPTY_SNAPSHOT();
    empty.spreadsheetId = primaryId;
    cache = { at: Date.now(), snap: empty };
    return empty;
  }
}

export function sheetRowDeepLink(spreadsheetId: string | null, rowIndex: number): string | null {
  if (!spreadsheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0&range=A${rowIndex}`;
}

// ---------------------------------------------------------------------------
// Form-gap vs DB — the DEFINITIVE "did this lead actually enter the CRM?" check.
//
// loadSheetGaps above trusts the sheet's own SENT/status markers. But a row can
// be marked SENT yet have no lead in the DB (created then purged, or a transient
// insert failure that still returned a sid). The only ground truth is: is the
// phone present in the `leads` table? This cross-checks every real row against
// the DB by the last-9 phone digits (format-independent: strips +/0/@suffix).
// ---------------------------------------------------------------------------
export interface FormGapVsDbRow {
  rowIndex: number;
  spreadsheetId: string;
  name: string;
  phone: string;
  sent: string | null;
  status: string | null;
  sid: string | null;
}
export interface FormGapVsDbSnapshot {
  checked: number; // real rows compared (name+phone, non-test)
  inSystem: number;
  notInSystem: FormGapVsDbRow[];
  fetchedAt: string;
  spreadsheetId: string | null;
}

const last9 = (s: string) => s.replace(/[^0-9]/g, "").slice(-9);

export async function loadFormGapsVsDb(): Promise<FormGapVsDbSnapshot> {
  const sheetIds = metaSheetIds();
  const primaryId = readEnv("GOOGLE_SHEETS_FB_LEADS_ID").trim() || sheetIds[0] || "";
  const empty = (): FormGapVsDbSnapshot => ({
    checked: 0,
    inSystem: 0,
    notInSystem: [],
    fetchedAt: new Date().toISOString(),
    spreadsheetId: primaryId || null,
  });
  if (sheetIds.length === 0) return empty();

  // id → rows, so a row's deep link points at the sheet it actually lives in.
  const perSheet: { id: string; lines: string[] }[] = [];
  for (const id of sheetIds) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`;
      const resp = await fetch(url, { redirect: "follow" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      perSheet.push({ id, lines: (await resp.text()).split(/\r?\n/) });
    } catch (e) {
      console.warn(`[sheets.form-gaps] ${id}: fetch failed — skipped`, e);
    }
  }
  if (perSheet.length === 0) return empty();

  // Lazy import keeps this file's other (db-free) exports safe for any caller.
  const { db } = await import("@/lib/db");
  const { leads } = await import("@/drizzle/schema");
  const dbRows = await db.select({ phone: leads.phoneE164, waJid: leads.waJid }).from(leads);
  const dbSet = new Set<string>();
  for (const r of dbRows) {
    for (const cand of [r.phone, r.waJid]) {
      if (!cand) continue;
      const k = last9(cand);
      if (k.length === 9) dbSet.add(k);
    }
  }

  const notInSystem: FormGapVsDbRow[] = [];
  let inSystem = 0;
  let checked = 0;
  for (const { id, lines } of perSheet) {
    const COL = resolveGapCols(parseCSVLine(lines[0] ?? ""));
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const r = parseCSVLine(line);
      const name = (r[COL.name] ?? "").trim();
      const rawPhone = (r[COL.phone] ?? "").trim();
      if (!name || !rawPhone) continue;
      if (rawPhone.toLowerCase().indexOf("test lead") !== -1) continue;
      checked++;
      const k = last9(rawPhone);
      if (k.length === 9 && dbSet.has(k)) {
        inSystem++;
        continue;
      }
      notInSystem.push({
        rowIndex: i + 1,
        spreadsheetId: id,
        name,
        phone: rawPhone,
        sent: (r[COL.sent] ?? "").trim() || null,
        status: (r[COL.status] ?? "").trim() || null,
        sid: (r[COL.sid] ?? "").trim() || null,
      });
    }
  }

  return {
    checked,
    inSystem,
    notInSystem,
    fetchedAt: new Date().toISOString(),
    spreadsheetId: primaryId || null,
  };
}

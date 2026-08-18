/**
 * Meta Lead Ads attribution enrichment.
 *
 * The FB-import Apps Script only forwards {phone, fullName} — it drops the Meta
 * leadgen id + ad/campaign ids that the CAPI-for-CRM conversion loop needs (see
 * memory meta-conversion-loop). But those DO live in the Meta form Google
 * Sheets (Meta's native connector writes the full row). So instead of editing
 * the Apps Script per-form, the CRM reads the sheet(s) on a schedule and fills
 * `leads.meta_*` by phone. Covers past + future leads; a new form is one more
 * sheet id in GOOGLE_SHEETS_FB_LEADS_IDS — no script copy, no Google edits.
 *
 * Columns are resolved by HEADER NAME (lib/sheets/fb-form-columns.ts), not by
 * position. Adding a question to the form inserts a column and shifts every
 * field after it — which used to move `phone` off index 13 and silently break
 * both this enrichment and the Apps Script's import. The historical indices
 * survive only as the fallback.
 *
 * The same pass also captures the customer's OWN answers to the form's
 * questions (any column that isn't ad metadata) into `leads.meta_form_answers`,
 * so "how many units / do you have a logo" reaches the CRM instead of dying in
 * the spreadsheet.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { leads } from "@/drizzle/schema";
import {
  resolveFbFormColumns,
  cell,
  rowAnswers,
  type FbFormColumns,
} from "@/lib/sheets/fb-form-columns";

// Every Meta form sheet we know of. These are ALWAYS read, and the env var
// adds to them rather than replacing them: a form sheet silently dropping out
// of the loop costs attribution on every lead it carries and shows up as
// nothing at all, whereas one extra public CSV fetch costs nothing.
// "Albadi leads v2" · "Form #2" · "טופס מסונן עברית 18.8.2026".
const DEFAULT_SHEET_IDS = [
  "1AnswoeBAFV-z4aN3KhqyJjb9DegyiDNH-0FcB8ry518",
  "1LB4DDcrhPC13pSNHiIDrWxVBH2K9dDhhwTBiE5wF9Tg",
  "18RsMyyHGjlUW98xpHROmAn6lxlAW1bTAXhOoEVa9OqQ",
];

export interface EnrichResult {
  sheets: number;
  sheetRows: number;
  leadsScanned: number;
  updated: number;
  stillMissing: number;
}

/** Which sheet ids to scan: env (comma-separated) ∪ single-id env ∪ defaults. */
export function metaSheetIds(): string[] {
  const multi = (process.env.GOOGLE_SHEETS_FB_LEADS_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const single = (process.env.GOOGLE_SHEETS_FB_LEADS_ID ?? "").trim();
  const ids = new Set<string>([...DEFAULT_SHEET_IDS, ...multi]);
  if (single) ids.add(single);
  return [...ids];
}

// Minimal CSV parser (handles quoted commas + escaped quotes + CRLF).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c !== "\r") cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const digits = (s: string) => (s || "").replace(/[^0-9]/g, "");
const last9 = (s: string) => digits(s).slice(-9);

interface MetaRec {
  leadgenId: string;
  adId: string | null;
  adName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  email: string | null;
  /** The form's own questions → the customer's answers, by column label. */
  answers: Record<string, string> | null;
}

/**
 * Read the configured sheets, match FB leads missing a leadgen id by phone, and
 * fill leads.meta_*. COALESCE-style: never overwrites an existing value.
 */
export async function enrichMetaAttribution(): Promise<EnrichResult> {
  const ids = metaSheetIds();
  const byPhone = new Map<string, MetaRec>();
  const byLast9 = new Map<string, MetaRec>();
  let sheetRows = 0;
  let sheetsOk = 0;

  for (const id of ids) {
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`;
    let text: string;
    try {
      const resp = await fetch(url, { redirect: "follow" });
      if (!resp.ok) {
        console.warn(`[meta-enrich] sheet ${id} HTTP ${resp.status}`);
        continue;
      }
      text = await resp.text();
    } catch (e) {
      console.warn(`[meta-enrich] sheet ${id} fetch failed`, e);
      continue;
    }
    sheetsOk++;
    const parsed = parseCsv(text);
    const cols: FbFormColumns = resolveFbFormColumns(parsed[0] ?? []);
    if (!cols.resolvedByName) {
      // Not fatal — the fallback indices still apply — but it means Meta
      // renamed a header, and the next shift will be read wrong. Say so.
      console.warn(`[meta-enrich] sheet ${id}: some columns fell back to fixed positions`);
    }
    const rows = parsed.slice(1); // drop header
    for (const r of rows) {
      const ph = digits(cell(r, cols, "phone"));
      // Meta writes the leadgen id with an "l:" prefix in the sheet (like the
      // phone's "p:"). Strip it — the CAPI lead_id must be the bare number.
      const leadgenId = cell(r, cols, "leadgenId").replace(/^\s*l:/i, "").trim();
      if (ph.length < 9 || !leadgenId) continue;
      const answers = rowAnswers(r, cols);
      const rec: MetaRec = {
        leadgenId,
        adId: cell(r, cols, "adId") || null,
        adName: cell(r, cols, "adName") || null,
        campaignId: cell(r, cols, "campaignId") || null,
        campaignName: cell(r, cols, "campaignName") || null,
        email: cell(r, cols, "email") || null,
        answers: Object.keys(answers).length ? answers : null,
      };
      sheetRows++;
      // Last write wins — later sheet rows are newer duplicates of a phone.
      byPhone.set(ph, rec);
      byLast9.set(last9(ph), rec);
    }
  }

  // FB leads still missing a leadgen id. We pull wa_jid/sid too: a lead's
  // phone_e164 can differ from the number the form captured (seen 2026-08-07 —
  // דגא מנשה's phone_e164 was a second number while the form's number lived in
  // his wa_jid), so matching on phone alone silently misses real leads.
  const res = await db.execute<{
    sid: string;
    phone: string | null;
    jid: string | null;
  }>(sql`
    SELECT manychat_sub_id AS sid, phone_e164 AS phone, wa_jid AS jid
    FROM leads
    WHERE (source = 'facebook_import' OR lead_source = 'facebook')
      AND (meta_leadgen_id IS NULL OR meta_form_answers IS NULL)`);
  const rows = res.rows;

  let updated = 0;
  for (const l of rows) {
    // Every number this lead is known by: stored phone, WhatsApp JID, and the
    // sid (bridge-origin sids are "<number>@s.whatsapp.net").
    const candidates = [l.phone ?? "", l.jid ?? "", l.sid ?? ""]
      .map((v) => digits(v))
      .filter((v) => v.length >= 9);
    let rec: MetaRec | undefined;
    for (const c of candidates) {
      rec = byPhone.get(c) || byLast9.get(last9(c));
      if (rec) break;
    }
    if (!rec) continue;
    await db
      .update(leads)
      .set({
        metaLeadgenId: sql`COALESCE(${leads.metaLeadgenId}, ${rec.leadgenId})`,
        metaAdId: sql`COALESCE(${leads.metaAdId}, ${rec.adId})`,
        metaAdName: sql`COALESCE(${leads.metaAdName}, ${rec.adName})`,
        metaCampaignId: sql`COALESCE(${leads.metaCampaignId}, ${rec.campaignId})`,
        metaCampaignName: sql`COALESCE(${leads.metaCampaignName}, ${rec.campaignName})`,
        metaFormEmail: sql`COALESCE(${leads.metaFormEmail}, ${rec.email})`,
        // The customer's own words. COALESCE so a hand-edited value survives.
        metaFormAnswers: rec.answers
          ? sql`COALESCE(${leads.metaFormAnswers}, ${JSON.stringify(rec.answers)}::jsonb)`
          : sql`${leads.metaFormAnswers}`,
      })
      .where(sql`trim(${leads.manychatSubId}) = ${l.sid.trim()}`);
    updated++;
  }

  return {
    sheets: sheetsOk,
    sheetRows,
    leadsScanned: rows.length,
    updated,
    stillMissing: rows.length - updated,
  };
}

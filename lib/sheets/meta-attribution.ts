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
 * Meta standard Instant-Form CSV columns (0-indexed), verified on both live
 * sheets — identical for the columns we read:
 *   0 id(leadgen) · 2 ad_id · 3 ad_name · 6 campaign_id · 7 campaign_name
 *   13 phone · 14 email
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { leads } from "@/drizzle/schema";

// Known Meta form sheets (fallback when GOOGLE_SHEETS_FB_LEADS_IDS is unset).
// "Albadi leads v2" + "Form #2".
const DEFAULT_SHEET_IDS = [
  "1AnswoeBAFV-z4aN3KhqyJjb9DegyiDNH-0FcB8ry518",
  "1LB4DDcrhPC13pSNHiIDrWxVBH2K9dDhhwTBiE5wF9Tg",
];

const COL_LEADGEN = 0;
const COL_AD_ID = 2;
const COL_AD_NAME = 3;
const COL_CAMPAIGN_ID = 6;
const COL_CAMPAIGN_NAME = 7;
const COL_PHONE = 13;
const COL_EMAIL = 14;

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
  const ids = new Set<string>(multi.length ? multi : DEFAULT_SHEET_IDS);
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
    const rows = parseCsv(text).slice(1); // drop header
    for (const r of rows) {
      const ph = digits(r[COL_PHONE] ?? "");
      // Meta writes the leadgen id with an "l:" prefix in the sheet (like the
      // phone's "p:"). Strip it — the CAPI lead_id must be the bare number.
      const leadgenId = (r[COL_LEADGEN] ?? "").replace(/^\s*l:/i, "").trim();
      if (ph.length < 9 || !leadgenId) continue;
      const rec: MetaRec = {
        leadgenId,
        adId: (r[COL_AD_ID] ?? "").trim() || null,
        adName: (r[COL_AD_NAME] ?? "").trim() || null,
        campaignId: (r[COL_CAMPAIGN_ID] ?? "").trim() || null,
        campaignName: (r[COL_CAMPAIGN_NAME] ?? "").trim() || null,
        email: (r[COL_EMAIL] ?? "").trim() || null,
      };
      sheetRows++;
      // Last write wins — later sheet rows are newer duplicates of a phone.
      byPhone.set(ph, rec);
      byLast9.set(last9(ph), rec);
    }
  }

  // FB leads still missing a leadgen id.
  const res = await db.execute<{ sid: string; phone: string | null }>(sql`
    SELECT manychat_sub_id AS sid, phone_e164 AS phone
    FROM leads
    WHERE (source = 'facebook_import' OR lead_source = 'facebook')
      AND meta_leadgen_id IS NULL`);
  const rows = res.rows;

  let updated = 0;
  for (const l of rows) {
    const ph = digits(l.phone ?? "");
    const rec = byPhone.get(ph) || byLast9.get(last9(l.phone ?? ""));
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

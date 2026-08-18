/**
 * Column resolution for the Meta Lead-Ads Google Sheets.
 *
 * Every reader of these sheets used to hardcode integer positions (phone = 13,
 * email = 14, …). That works exactly until the form changes: adding a question
 * inserts a column, every field after it shifts one right, and the failure is
 * SILENT — the Apps Script posts an answer as the phone number, so leads stop
 * entering WhatsApp with no error anywhere. This is the same trap that hit the
 * Feishu factory sheet three times (see CLAUDE.md); doing it by name is the
 * fix that was deferred there and is cheap to do here.
 *
 * So: resolve by HEADER NAME, fall back to the historical index only when the
 * name isn't found. A sheet whose headers Meta renames still works; a sheet
 * with extra questions works and the questions become `answers`.
 */

/** Header aliases per logical field. Lowercased, compared after normalising. */
const ALIASES: Record<string, string[]> = {
  leadgenId: ["id", "lead_id", "leadgen_id"],
  createdTime: ["created_time", "created"],
  adId: ["ad_id"],
  adName: ["ad_name"],
  adsetId: ["adset_id"],
  adsetName: ["adset_name"],
  campaignId: ["campaign_id"],
  campaignName: ["campaign_name"],
  formId: ["form_id"],
  formName: ["form_name"],
  isOrganic: ["is_organic"],
  platform: ["platform"],
  fullName: ["full_name", "שם_מלא", "שם מלא"],
  phone: ["phone_number", "phone", "מספר_טלפון", "טלפון"],
  email: ["email", 'דוא"ל', "דואל", "דוא״ל"],
  leadStatus: ["lead_status"],
};

/** Historical positions — the fallback when a header is missing or renamed. */
const FALLBACK: Record<string, number> = {
  leadgenId: 0, createdTime: 1, adId: 2, adName: 3, adsetId: 4, adsetName: 5,
  campaignId: 6, campaignName: 7, formId: 8, formName: 9, isOrganic: 10,
  platform: 11, fullName: 12, phone: 13, email: 14, leadStatus: 16,
};

/**
 * Columns that are never a customer's answer: ad metadata, the identity fields
 * we already store as their own thing, and the Apps Script's marker columns
 * (blank headers — SENT / status / sid). Everything ELSE in the sheet is a
 * question the form asked, whatever it is called.
 */
const NOT_AN_ANSWER = new Set([
  "leadgenId", "createdTime", "adId", "adName", "adsetId", "adsetName",
  "campaignId", "campaignName", "formId", "formName", "isOrganic", "platform",
  "fullName", "phone", "leadStatus",
]);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");

export interface FbFormColumns {
  /** index per logical field; -1 when neither the header nor a fallback exists */
  idx: Record<string, number>;
  /** Extra columns = the form's own questions, in sheet order. */
  answers: { index: number; label: string }[];
  /** True when every field was found by name — i.e. shift-proof for this sheet. */
  resolvedByName: boolean;
}

export function resolveFbFormColumns(header: string[]): FbFormColumns {
  const normalised = header.map(norm);
  const idx: Record<string, number> = {};
  let byName = 0;

  for (const [field, names] of Object.entries(ALIASES)) {
    const found = normalised.findIndex((h) => names.some((n) => norm(n) === h));
    if (found >= 0) {
      idx[field] = found;
      byName++;
    } else {
      // Only trust the fallback if that position exists in this sheet at all.
      const fb = FALLBACK[field];
      idx[field] = fb !== undefined && fb < header.length ? fb : -1;
    }
  }

  const claimed = new Set(Object.entries(idx).filter(([f]) => NOT_AN_ANSWER.has(f)).map(([, i]) => i));
  const answers: { index: number; label: string }[] = [];
  header.forEach((h, i) => {
    const label = h.trim();
    // A blank header is an Apps Script marker column, not a question.
    if (!label || claimed.has(i)) return;
    answers.push({ index: i, label });
  });

  return { idx, answers, resolvedByName: byName === Object.keys(ALIASES).length };
}

/** Read a cell by logical field name; "" when the column doesn't exist. */
export function cell(row: string[], cols: FbFormColumns, field: string): string {
  const i = cols.idx[field];
  return i >= 0 ? (row[i] ?? "").trim() : "";
}

/** The form's answers for one row, blanks dropped. */
export function rowAnswers(row: string[], cols: FbFormColumns): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of cols.answers) {
    const v = (row[a.index] ?? "").trim();
    if (v) out[a.label] = v;
  }
  return out;
}

/**
 * Settings for the Google Ads side of the "מודעות" tab — "הגדרות ← שיווק · גוגל".
 *
 * A separate world from Meta (Eli, 2026-09-23: "ברור שאלו שני עולמות שונים"):
 * nothing here is read from or shared with `recommendation-settings.ts`. The
 * business facts (profit per deal, max CAC) start from the same approved
 * numbers but are edited here, for Google, on their own.
 *
 * Client-safe: no server imports, no env — the settings screen validates in
 * the browser. Changing a setting changes alerts and displayed metrics only;
 * nothing here reaches Google Ads.
 *
 * Plan: docs/plans/2026-09-23-google-ads-tab-design.md.
 */
import { z } from "zod";

export const GOOGLE_SETTINGS_SCHEMA_VERSION = 1;

export interface GoogleAdsSettings {
  economics: {
    /** Contribution profit of a first deal, before ads and overhead. ₪. */
    contributionProfitIls: number;
    /** CAC ceiling for Google. ₪. */
    maxCacIls: number;
    /** Google CPL target. Empty until Eli sets one — Search is not Meta's ₪12.50. */
    targetCplIls: number | null;
  };
  suitableLead: {
    /** GHL tag that marks a suitable lead. */
    tag: string;
  };
  alerts: {
    /** An ENABLED campaign with ₪0 for this many full days → red. */
    noSpendDays: number;
    /** Clicks in the window at or above this, with 0 CRM leads → red. */
    clicksWithoutLeadsMin: number;
    /** Window for the clicks-without-leads check. */
    clicksWindowDays: number;
    /** Allowed daily difference between Google's form conversions and CRM leads. */
    gapToleranceLeads: number;
    /** Google leads this recent without a campaign → red. */
    attributionLookbackDays: number;
  };
  measurement: {
    /** The form conversion action Google counts (Albadi: "ליד – טופס הצעת מחיר"). */
    formConversionActionId: string;
    /** Count a WhatsApp lead whose prefill says it came from Google. */
    countWhatsAppPrefill: boolean;
  };
  /** CRM → Google offline conversions (phase 5). */
  reporting: {
    qualifiedValueIls: number;
    quoteValueIls: number;
    qualifiedActionId: string;
    quoteActionId: string;
    purchaseActionId: string;
  };
}

/** Starting point, 2026-09-23. Economics copied from the approved Meta numbers
 *  of 18/09 as business facts; CPL deliberately empty. */
export const GOOGLE_DEFAULTS_2026_09_23: GoogleAdsSettings = {
  economics: { contributionProfitIls: 1500, maxCacIls: 500, targetCplIls: null },
  suitableLead: { tag: "good lead" },
  alerts: {
    noSpendDays: 1,
    clicksWithoutLeadsMin: 30,
    clicksWindowDays: 7,
    gapToleranceLeads: 1,
    attributionLookbackDays: 14,
  },
  measurement: { formConversionActionId: "7710681316", countWhatsAppPrefill: true },
  // The three UPLOAD_CLICKS actions created 17/08 ("CRM – …"); values = their Google defaults.
  reporting: { qualifiedValueIls: 100, quoteValueIls: 300, qualifiedActionId: "7711834479", quoteActionId: "7711834482", purchaseActionId: "7711834485" },
};

export const GOOGLE_GROUPS: { key: keyof GoogleAdsSettings; title: string; description: string }[] = [
  { key: "economics", title: "כלכלה — גוגל", description: "כמה שווה עסקה וכמה מותר לשלם עליה בגוגל. נפרד מהמספרים של מטא." },
  { key: "suitableLead", title: "ליד מתאים — גוגל", description: "התגית ב-GHL שמסמנת ליד מתאים, לספירה בלשונית גוגל." },
  { key: "alerts", title: "ספי התראות", description: "מתי שורת החיבורים הופכת לאדומה ונשלחת הודעה בוואטסאפ." },
  { key: "measurement", title: "מדידה", description: "מה נחשב ליד מגוגל ואיזו פעולת המרה משווים מול ה-CRM." },
  { key: "reporting", title: "דיווח חזרה לגוגל", description: "אילו אירועים מה-CRM נשלחים לגוגל ובאיזה ערך, כדי שגוגל תלמד מה ליד טוב. עסקה נשלחת תמיד בסכום האמיתי." },
];

export const GOOGLE_FIELD_LABELS: Record<string, { label: string; unit?: string }> = {
  "economics.contributionProfitIls": { label: "רווח תרומה לעסקה ראשונה", unit: "₪" },
  "economics.maxCacIls": { label: "CAC מקסימלי בגוגל", unit: "₪" },
  "economics.targetCplIls": { label: "CPL יעד בגוגל", unit: "₪" },
  "suitableLead.tag": { label: "תגית GHL של ליד מתאים" },
  "alerts.noSpendDays": { label: "ימים בלי הוצאה לקמפיין פעיל", unit: "ימים" },
  "alerts.clicksWithoutLeadsMin": { label: "קליקים בלי אף ליד", unit: "קליקים" },
  "alerts.clicksWindowDays": { label: "חלון לבדיקת קליקים בלי לידים", unit: "ימים" },
  "alerts.gapToleranceLeads": { label: "פער מותר גוגל ↔ CRM ביום", unit: "לידים" },
  "alerts.attributionLookbackDays": { label: "חלון לבדיקת לידים בלי שיוך", unit: "ימים" },
  "measurement.formConversionActionId": { label: "מזהה פעולת ההמרה של הטופס" },
  "measurement.countWhatsAppPrefill": { label: "לספור וואטסאפ עם ״הגעתי מגוגל״" },
  "reporting.qualifiedValueIls": { label: "ערך ליד איכותי", unit: "₪" },
  "reporting.quoteValueIls": { label: "ערך הצעת מחיר שנשלחה", unit: "₪" },
  "reporting.qualifiedActionId": { label: "פעולת ההמרה — ליד איכותי" },
  "reporting.quoteActionId": { label: "פעולת ההמרה — הצעת מחיר" },
  "reporting.purchaseActionId": { label: "פעולת ההמרה — עסקה" },
};

export const GOOGLE_SETTING_HELP: Record<string, { help: string; whenUnset?: string }> = {
  "economics.contributionProfitIls": { help: "כמה נשאר מעסקה ראשונה אחרי ייצור, שילוח וטיפול, לפני פרסום. משמש לחישוב \"רווח אחרי פרסום\" לכל קמפיין בגוגל." },
  "economics.maxCacIls": { help: "התקרה לעלות עסקה אחת מגוגל. קמפיין מעל התקרה מסומן לבדיקה. לא נוגע בשום הגדרה ב-Google Ads." },
  "economics.targetCplIls": {
    help: "עלות ליד שנחשבת טובה בגוגל. מוצגת ליד ה-CPL של כל קמפיין.",
    whenUnset: "ריק = אין יעד. ליד מחיפוש בגוגל עולה אחרת מליד מטופס מיידי במטא — קבע אחרי חודש נתונים.",
  },
  "suitableLead.tag": { help: "התגית ב-GHL שאתה שם על ליד מתאים. נספרת רק בלשונית גוגל; שינוי כאן לא משנה את מטא." },
  "alerts.noSpendDays": { help: "קמפיין שמסומן ENABLED בגוגל ולא הוציא שקל במשך הימים המלאים האלה — כנראה נדחה, חסום בתשלום או בלי תקציב." },
  "alerts.clicksWithoutLeadsMin": { help: "אם בחלון הזמן היו לפחות כך קליקים ואף ליד מגוגל לא נכנס ל-CRM — כנראה המדידה או הטופס שבורים." },
  "alerts.clicksWindowDays": { help: "כמה ימים אחורה נבדקים הקליקים והלידים." },
  "alerts.gapToleranceLeads": { help: "גוגל סופרת המרות טופס; ה-CRM סופר לידים מגוגל. פער גדול מזה ביום סגור = אדום. פער קטן נרשם ומוצג בלבד." },
  "alerts.attributionLookbackDays": { help: "ליד מגוגל מהימים האלה שלא שויך לקמפיין (או \"לא נמצא\") = אדום." },
  "measurement.formConversionActionId": { help: "פעולת ההמרה בגוגל שסופרת טופס הצעת מחיר. מולה משווים את לידי ה-CRM." },
  "measurement.countWhatsAppPrefill": { help: "ליד שפנה בוואטסאפ מכפתור באתר עם הטקסט \"הגעתי מגוגל\" נספר כליד מגוגל, בלי קמפיין (אין לו מזהה קליק)." },
  "reporting.qualifiedValueIls": { help: "הערך שנשלח לגוגל כשליד מגוגל מסומן ״ליד טוב״ או עובר לאפיון. גוגל משתמשת בערך כדי להעדיף לידים כאלה." },
  "reporting.quoteValueIls": { help: "הערך שנשלח לגוגל כשליד מגוגל מגיע לשלב שוקל / משא ומתן (הצעת מחיר בידיו)." },
  "reporting.qualifiedActionId": { help: "פעולת ההמרה בגוגל (סוג העלאה) שמקבלת לידים איכותיים. נוצרה 17/08 בשם ״CRM – ליד איכותי״." },
  "reporting.quoteActionId": { help: "פעולת ההמרה בגוגל שמקבלת הצעות מחיר. ״CRM – נשלחה הצעת מחיר״." },
  "reporting.purchaseActionId": { help: "פעולת ההמרה בגוגל שמקבלת עסקאות, בסכום העסקה בפועל לפני מע״מ. ״CRM – מקדמה / עסקה״." },
};

const money = z.number().finite().positive();
const posInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();

const schema = z
  .object({
    economics: z.object({ contributionProfitIls: money, maxCacIls: money, targetCplIls: money.nullable() }).strict(),
    suitableLead: z.object({ tag: z.string() }).strict(),
    alerts: z
      .object({
        noSpendDays: posInt,
        clicksWithoutLeadsMin: posInt,
        clicksWindowDays: posInt,
        gapToleranceLeads: nonNegInt,
        attributionLookbackDays: posInt,
      })
      .strict(),
    measurement: z.object({ formConversionActionId: z.string(), countWhatsAppPrefill: z.boolean() }).strict(),
    reporting: z
      .object({ qualifiedValueIls: money, quoteValueIls: money, qualifiedActionId: z.string(), quoteActionId: z.string(), purchaseActionId: z.string() })
      .strict(),
  })
  .strict();

export interface GoogleSettingsError {
  path: string;
  message: string;
}

export type GoogleValidation = { ok: true; value: GoogleAdsSettings } | { ok: false; errors: GoogleSettingsError[] };

export function validateGoogleSettings(raw: unknown): GoogleValidation {
  const p = schema.safeParse(raw);
  if (!p.success) {
    return {
      ok: false,
      errors: p.error.issues.map((i) => {
        const path = i.path.join(".");
        const label = GOOGLE_FIELD_LABELS[path]?.label ?? path;
        const message = i.code === "unrecognized_keys" ? `שדה לא מוכר: ${i.keys.join(", ")}` : `${label}: ערך לא תקין`;
        return { path, message };
      }),
    };
  }
  const v = p.data as GoogleAdsSettings;
  const errors: GoogleSettingsError[] = [];
  if (!v.suitableLead.tag.trim()) errors.push({ path: "suitableLead.tag", message: "חסרה תגית GHL של ליד מתאים" });
  if (!/^\d{5,20}$/.test(v.measurement.formConversionActionId.trim())) {
    errors.push({ path: "measurement.formConversionActionId", message: "מזהה פעולת ההמרה חייב להיות מספר" });
  }
  for (const k of ["qualifiedActionId", "quoteActionId", "purchaseActionId"] as const) {
    if (!/^\d{5,20}$/.test(v.reporting[k].trim())) errors.push({ path: `reporting.${k}`, message: "מזהה פעולת ההמרה חייב להיות מספר" });
  }
  if (v.alerts.clicksWindowDays > 30) errors.push({ path: "alerts.clicksWindowDays", message: "חלון הקליקים עד 30 יום" });
  if (v.alerts.attributionLookbackDays > 90) {
    errors.push({ path: "alerts.attributionLookbackDays", message: "גוגל שומרת קליקים 90 יום בלבד" });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}

/** Relations shown as a warning, never enforced. */
export function googleConsistencyWarnings(s: GoogleAdsSettings): string[] {
  const out: string[] = [];
  if (s.economics.maxCacIls > s.economics.contributionProfitIls) {
    out.push(`CAC מקסימלי (₪${s.economics.maxCacIls}) גבוה מהרווח לעסקה (₪${s.economics.contributionProfitIls}) — כל עסקה בתקרה מפסידה`);
  }
  if (s.economics.targetCplIls !== null && s.economics.targetCplIls > s.economics.maxCacIls) {
    out.push(`CPL יעד (₪${s.economics.targetCplIls}) גבוה מה-CAC המקסימלי (₪${s.economics.maxCacIls})`);
  }
  return out;
}

export function changedGoogleKeys(before: GoogleAdsSettings | null, after: GoogleAdsSettings): string[] {
  const out: string[] = [];
  for (const g of Object.keys(after) as (keyof GoogleAdsSettings)[]) {
    for (const [k, v] of Object.entries(after[g])) {
      const prev = before ? (before[g] as Record<string, unknown>)[k] : undefined;
      if (!before || prev !== v) out.push(`${g}.${k}`);
    }
  }
  return out;
}

export function googleSettingsToMarkdown(s: GoogleAdsSettings, revision: number): string {
  const lines = [`## הגדרות Google Ads ב-CRM — גרסה ${revision}`, ""];
  for (const g of GOOGLE_GROUPS) {
    lines.push(`### ${g.title}`);
    for (const [k, v] of Object.entries(s[g.key])) {
      const f = GOOGLE_FIELD_LABELS[`${g.key}.${k}`];
      const val = v === null ? "לא מוגדר" : typeof v === "boolean" ? (v ? "כן" : "לא") : String(v);
      lines.push(`- ${f?.label ?? k}: ${val}${v !== null && f?.unit ? ` ${f.unit}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** A stored document from before a group existed gets that group's defaults —
 *  never "invalid → silently back to all defaults". Unknown keys still fail. */
export function withGoogleDefaults(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  for (const [g, def] of Object.entries(GOOGLE_DEFAULTS_2026_09_23)) {
    const cur = r[g];
    out[g] = cur && typeof cur === "object" ? { ...def, ...(cur as object) } : def;
  }
  return out;
}

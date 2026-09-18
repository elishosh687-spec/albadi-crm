/**
 * Policy for the Meta ad recommendation engine — "מודעות → הגדרות בדיקה".
 *
 * Client-safe on purpose: no server imports, no env. The settings screen needs
 * the defaults and the validator in the browser, and the engine runs there too
 * for the live preview.
 *
 * Every number that can change a recommendation lives here and is editable in
 * the widget. The marketing documents (`tests.md`, `meta-ads.md`) are the
 * rationale and history; they are never read at runtime.
 *
 * Design: docs/plans/2026-09-18-meta-ad-recommendations-settings-design.md
 */
import { z } from "zod";

export const SETTINGS_SCHEMA_VERSION = 1;

export interface AdRecommendationSettings {
  economics: {
    /** Contribution profit of a first deal, before ads and overhead. ₪. */
    contributionProfitIls: number;
    /** Target LTGP:CAC ratio (3 = 3:1). Rationale for maxCacIls only. */
    targetLtgpCacRatio: number;
    /** CAC ceiling used by the decisions. Edited directly, never derived. ₪. */
    maxCacIls: number;
    /** Early-filter CPL target. Edited directly, never derived. ₪. */
    targetCplIls: number;
    /** Planning assumption: leads per closed deal. */
    expectedLeadsPerDeal: number;
    /** A real CRM deal blocks a recommendation that rests on CPL alone. */
    dealOverridesCplStop: boolean;
  };
  gates: {
    firstGateSpendIls: number;
    /** Meta leads at the first gate for a clear pass. */
    firstGatePassLeads: number;
    /** Start of the quality-review band. */
    firstGateReviewMin: number;
    /** At or below this many leads at the first gate → early stop. */
    firstGateStopMax: number;
    stabilitySpendIls: number;
    dealProofSpendIls: number;
    /** Days after the last actual spend before a no-deal ad can be a loser. */
    maturationDays: number;
    /** For expected-duration display only. Never changes a Meta budget. */
    referenceDailyBudgetIls: number;
  };
  suitableLead: {
    /** The GHL tag Eli applies. The ONLY source of "ליד מתאים". */
    tag: string;
    /** Unset until Eli defines one — the approved method has no number. */
    qualityOverrideMinSuitable: number | null;
    allowQualityOverride: boolean;
  };
  structure: {
    maxActiveAds: number;
    controlSlots: number;
    challengerSlots: number;
    remarketingSlots: number;
    evaluateRemarketingSeparately: boolean;
  };
  verdict: {
    winnerMinDeals: number;
    winnerRequiresCacAtOrBelowTarget: boolean;
    /** The no-deal loser gate is `gates.dealProofSpendIls`. */
    loserRequiresMaturation: boolean;
  };
}

/** Approved by Eli on 2026-09-18 (tests.md). "Reset" restores exactly these. */
export const APPROVED_DEFAULTS_2026_09_18: AdRecommendationSettings = {
  economics: {
    contributionProfitIls: 1500,
    targetLtgpCacRatio: 3,
    maxCacIls: 500,
    targetCplIls: 12.5,
    expectedLeadsPerDeal: 40,
    dealOverridesCplStop: true,
  },
  gates: {
    firstGateSpendIls: 100,
    firstGatePassLeads: 8,
    firstGateReviewMin: 5,
    firstGateStopMax: 4,
    stabilitySpendIls: 250,
    dealProofSpendIls: 500,
    maturationDays: 14,
    referenceDailyBudgetIls: 20,
  },
  suitableLead: {
    tag: "good lead",
    qualityOverrideMinSuitable: null,
    allowQualityOverride: false,
  },
  structure: {
    maxActiveAds: 4,
    controlSlots: 2,
    challengerSlots: 1,
    remarketingSlots: 1,
    evaluateRemarketingSeparately: true,
  },
  verdict: {
    winnerMinDeals: 1,
    winnerRequiresCacAtOrBelowTarget: true,
    loserRequiresMaturation: true,
  },
};

/** Hebrew label + unit per field — used by error messages and the screen. */
export const FIELD_LABELS: Record<string, { label: string; unit?: string }> = {
  "economics.contributionProfitIls": { label: "רווח תרומה לעסקה ראשונה", unit: "₪" },
  "economics.targetLtgpCacRatio": { label: "יחס LTGP:CAC יעד", unit: "ל-1" },
  "economics.maxCacIls": { label: "CAC מקסימלי", unit: "₪" },
  "economics.targetCplIls": { label: "CPL יעד", unit: "₪" },
  "economics.expectedLeadsPerDeal": { label: "לידים צפויים לעסקה", unit: "לידים" },
  "economics.dealOverridesCplStop": { label: "עסקה גוברת על עצירה לפי CPL" },
  "gates.firstGateSpendIls": { label: "הוצאת סינון ראשוני", unit: "₪" },
  "gates.firstGatePassLeads": { label: "לידים למעבר ברור בשער הראשון", unit: "לידים" },
  "gates.firstGateReviewMin": { label: "תחילת טווח בדיקת האיכות", unit: "לידים" },
  "gates.firstGateStopMax": { label: "מקסימום לידים לעצירה מוקדמת", unit: "לידים" },
  "gates.stabilitySpendIls": { label: "הוצאת בדיקת יציבות", unit: "₪" },
  "gates.dealProofSpendIls": { label: "הוצאת הוכחת עסקה", unit: "₪" },
  "gates.maturationDays": { label: "ימי הבשלה אחרי עצירת הוצאה", unit: "ימים" },
  "gates.referenceDailyBudgetIls": { label: "תקציב יומי לחישוב משך", unit: "₪" },
  "suitableLead.tag": { label: "תגית GHL של ליד מתאים" },
  "suitableLead.qualityOverrideMinSuitable": { label: "מינימום לידים מתאימים לעקיפת איכות", unit: "לידים" },
  "suitableLead.allowQualityOverride": { label: "לאפשר עקיפת איכות" },
  "structure.maxActiveAds": { label: "מקסימום מודעות פעילות במקביל", unit: "מודעות" },
  "structure.controlSlots": { label: "משבצות Control", unit: "מודעות" },
  "structure.challengerSlots": { label: "משבצות Challenger לקהל קר", unit: "מודעות" },
  "structure.remarketingSlots": { label: "משבצות רימרקטינג", unit: "מודעות" },
  "structure.evaluateRemarketingSeparately": { label: "רימרקטינג נבחן בנפרד" },
  "verdict.winnerMinDeals": { label: "מינימום עסקאות למועמדת למנצחת", unit: "עסקאות" },
  "verdict.winnerRequiresCacAtOrBelowTarget": { label: "מנצחת מחייבת CAC עד היעד" },
  "verdict.loserRequiresMaturation": { label: "מפסידה מחייבת תקופת הבשלה" },
};

const money = z.number().finite().positive();
const count = z.number().int().nonnegative();
const posCount = z.number().int().positive();

// `.strict()` everywhere: an unknown key is an ERROR, never silently dropped.
// A field the schema doesn't list would otherwise vanish on save while the
// screen showed it as saved (see memory "Zod strips what it doesn't list").
const schema = z
  .object({
    economics: z
      .object({
        contributionProfitIls: money,
        targetLtgpCacRatio: money,
        maxCacIls: money,
        targetCplIls: money,
        expectedLeadsPerDeal: money,
        dealOverridesCplStop: z.boolean(),
      })
      .strict(),
    gates: z
      .object({
        firstGateSpendIls: money,
        firstGatePassLeads: posCount,
        firstGateReviewMin: posCount,
        firstGateStopMax: count,
        stabilitySpendIls: money,
        dealProofSpendIls: money,
        maturationDays: count,
        referenceDailyBudgetIls: money,
      })
      .strict(),
    suitableLead: z
      .object({
        tag: z.string(),
        qualityOverrideMinSuitable: posCount.nullable(),
        allowQualityOverride: z.boolean(),
      })
      .strict(),
    structure: z
      .object({
        maxActiveAds: posCount,
        controlSlots: count,
        challengerSlots: count,
        remarketingSlots: count,
        evaluateRemarketingSeparately: z.boolean(),
      })
      .strict(),
    verdict: z
      .object({
        winnerMinDeals: posCount,
        winnerRequiresCacAtOrBelowTarget: z.boolean(),
        loserRequiresMaturation: z.boolean(),
      })
      .strict(),
  })
  .strict();

export interface SettingsError {
  /** Dotted path, e.g. "gates.stabilitySpendIls". Empty for whole-document errors. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: AdRecommendationSettings }
  | { ok: false; errors: SettingsError[] };

const labelOf = (path: string) => FIELD_LABELS[path]?.label ?? path;

function zodMessage(issue: z.ZodIssue): string {
  const path = issue.path.join(".");
  const label = labelOf(path);
  switch (issue.code) {
    case "unrecognized_keys":
      return `שדה לא מוכר: ${issue.keys.join(", ")}`;
    case "invalid_type":
      return issue.received === "undefined"
        ? `חסר ערך: ${label}`
        : `${label}: סוג ערך לא תקין`;
    case "too_small":
      return `${label}: חייב להיות גדול מ-0`;
    case "invalid_string":
      return `${label}: ערך לא תקין`;
    default:
      if (issue.message.includes("integer")) return `${label}: חייב להיות מספר שלם`;
      return `${label}: ערך לא תקין`;
  }
}

/**
 * Validate a full settings document. Rejects — never repairs — impossible
 * ranges. Invalid input must leave the last valid policy in force.
 */
export function validateSettings(raw: unknown): ValidationResult {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: zodMessage(i),
      })),
    };
  }
  const s = parsed.data as AdRecommendationSettings;
  const errors: SettingsError[] = [];
  const g = s.gates;

  if (!(g.firstGateSpendIls < g.stabilitySpendIls)) {
    errors.push({
      path: "gates.stabilitySpendIls",
      message: `הוצאת בדיקת היציבות (₪${g.stabilitySpendIls}) חייבת להיות גבוהה מהוצאת הסינון הראשוני (₪${g.firstGateSpendIls})`,
    });
  }
  if (!(g.stabilitySpendIls < g.dealProofSpendIls)) {
    errors.push({
      path: "gates.dealProofSpendIls",
      message: `הוצאת הוכחת העסקה (₪${g.dealProofSpendIls}) חייבת להיות גבוהה מהוצאת בדיקת היציבות (₪${g.stabilitySpendIls})`,
    });
  }
  // The three first-gate bands must tile the lead counts with no gap and no
  // overlap: [0..stopMax] stop, [reviewMin..pass-1] review, [pass..] pass.
  if (g.firstGateReviewMin !== g.firstGateStopMax + 1) {
    errors.push({
      path: "gates.firstGateReviewMin",
      message: `תחילת טווח בדיקת האיכות (${g.firstGateReviewMin}) חייבת להיות בדיוק אחת מעל מקסימום העצירה (${g.firstGateStopMax}) — אחרת יש מספר לידים שאין לו החלטה או שיש לו שתיים`,
    });
  }
  if (!(g.firstGatePassLeads > g.firstGateReviewMin)) {
    errors.push({
      path: "gates.firstGatePassLeads",
      message: `לידים למעבר ברור (${g.firstGatePassLeads}) חייבים להיות יותר מתחילת טווח בדיקת האיכות (${g.firstGateReviewMin})`,
    });
  }

  const st = s.structure;
  const slots = st.controlSlots + st.challengerSlots + st.remarketingSlots;
  if (slots > st.maxActiveAds) {
    errors.push({
      path: "structure.maxActiveAds",
      message: `סך המשבצות (${slots}) גדול ממקסימום המודעות הפעילות (${st.maxActiveAds})`,
    });
  }

  const tag = s.suitableLead.tag.trim();
  if (!tag) {
    errors.push({ path: "suitableLead.tag", message: "חסרה תגית GHL של ליד מתאים" });
  }
  if (s.suitableLead.allowQualityOverride && s.suitableLead.qualityOverrideMinSuitable === null) {
    errors.push({
      path: "suitableLead.qualityOverrideMinSuitable",
      message: "אי אפשר להפעיל עקיפת איכות בלי לקבוע מינימום לידים מתאימים",
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...s, suitableLead: { ...s.suitableLead, tag } } };
}

/**
 * Consistency hints between directly edited numbers. Warnings only — the
 * saved values are never overwritten by a derived one.
 */
export function consistencyWarnings(s: AdRecommendationSettings): string[] {
  const out: string[] = [];
  const e = s.economics;
  const cac = e.contributionProfitIls / e.targetLtgpCacRatio;
  if (Math.abs(cac - e.maxCacIls) > 0.005) {
    out.push(
      `₪${fmt(e.contributionProfitIls)} / ${fmt(e.targetLtgpCacRatio)} = ₪${fmt(cac)}, אבל ה-CAC המקסימלי שמור כ-₪${fmt(e.maxCacIls)}`,
    );
  }
  const cpl = e.maxCacIls / e.expectedLeadsPerDeal;
  if (Math.abs(cpl - e.targetCplIls) > 0.005) {
    out.push(
      `₪${fmt(e.maxCacIls)} / ${fmt(e.expectedLeadsPerDeal)} = ₪${fmt(cpl)}, אבל ה-CPL היעד שמור כ-₪${fmt(e.targetCplIls)}`,
    );
  }
  return out;
}

/**
 * A stored document from an older schema may miss keys added later. Fill the
 * missing ones from the approved defaults, then validate. Keys that are no
 * longer part of the schema are dropped here (and only here) — this is a
 * migration of OUR stored shape, not user input.
 */
export function normalizeStoredSettings(raw: unknown): ValidationResult {
  const src = isObj(raw) ? raw : {};
  const merged: Record<string, unknown> = {};
  for (const [group, defaults] of Object.entries(APPROVED_DEFAULTS_2026_09_18)) {
    const stored = isObj(src[group]) ? (src[group] as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) {
      out[key] = key in stored ? stored[key] : (defaults as Record<string, unknown>)[key];
    }
    merged[group] = out;
  }
  return validateSettings(merged);
}

/** Copyable summary for the strategy documents. */
export function settingsToMarkdown(s: AdRecommendationSettings, revision: number): string {
  const e = s.economics;
  const g = s.gates;
  const q = s.suitableLead;
  const st = s.structure;
  const v = s.verdict;
  const yes = (b: boolean) => (b ? "כן" : "לא");
  return [
    `## מדיניות המלצות מודעות — גרסה ${revision}`,
    "",
    "> הערכים החיים נמצאים ב-מודעות → הגדרות בדיקה. זהו צילום בלבד.",
    "",
    "### כלכלה",
    `- רווח תרומה לעסקה ראשונה: ₪${fmt(e.contributionProfitIls)}`,
    `- יחס LTGP:CAC יעד: ${fmt(e.targetLtgpCacRatio)}:1`,
    `- CAC מקסימלי: ₪${fmt(e.maxCacIls)}`,
    `- CPL יעד: ₪${fmt(e.targetCplIls)}`,
    `- לידים צפויים לעסקה: ${fmt(e.expectedLeadsPerDeal)}`,
    `- עסקה גוברת על עצירה לפי CPL: ${yes(e.dealOverridesCplStop)}`,
    "",
    "### שערי בדיקה",
    `- סינון ראשוני: ₪${fmt(g.firstGateSpendIls)} — מעבר מ-${g.firstGatePassLeads} לידים, בדיקת איכות ${g.firstGateReviewMin}–${g.firstGatePassLeads - 1}, עצירה ב-${g.firstGateStopMax} ומטה`,
    `- בדיקת יציבות: ₪${fmt(g.stabilitySpendIls)}`,
    `- הוכחת עסקה: ₪${fmt(g.dealProofSpendIls)}`,
    `- הבשלה אחרי עצירת הוצאה: ${g.maturationDays} ימים`,
    `- תקציב יומי לחישוב משך: ₪${fmt(g.referenceDailyBudgetIls)}`,
    "",
    "### ליד מתאים",
    `- תגית GHL: \`${q.tag}\``,
    `- עקיפת איכות: ${q.allowQualityOverride && q.qualityOverrideMinSuitable !== null ? `מופעלת מ-${q.qualityOverrideMinSuitable} לידים מתאימים` : "כבויה"}`,
    "",
    "### מבנה סבב",
    `- מקסימום מודעות פעילות: ${st.maxActiveAds} (Control ${st.controlSlots}, Challenger ${st.challengerSlots}, רימרקטינג ${st.remarketingSlots})`,
    `- רימרקטינג נבחן בנפרד: ${yes(st.evaluateRemarketingSeparately)}`,
    "",
    "### מנצחת / מפסידה",
    `- מינימום עסקאות למועמדת למנצחת: ${v.winnerMinDeals}`,
    `- מנצחת מחייבת CAC עד היעד: ${yes(v.winnerRequiresCacAtOrBelowTarget)}`,
    `- מפסידה: ללא עסקה אחרי ₪${fmt(g.dealProofSpendIls)}${v.loserRequiresMaturation ? ` ו-${g.maturationDays} ימי הבשלה` : ""}`,
  ].join("\n");
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2).replace(/\.?0+$/, "");
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Dotted paths whose value differs — recorded on every policy revision. */
export function changedSettingKeys(
  prev: AdRecommendationSettings | null,
  next: AdRecommendationSettings,
): string[] {
  const out: string[] = [];
  for (const [group, fields] of Object.entries(next)) {
    for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
      const before = prev ? (prev as unknown as Record<string, Record<string, unknown>>)[group]?.[key] : undefined;
      if (!prev || before !== value) out.push(`${group}.${key}`);
    }
  }
  return out;
}

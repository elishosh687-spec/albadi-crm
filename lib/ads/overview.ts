/**
 * Pure helpers behind the redesigned "מודעות" tab: the "לטיפול עכשיו" list,
 * the plain-Hebrew meaning under each KPI, and the join between the per-name
 * lead-quality report (DB only, always available) and the per-Ad-ID
 * recommendations (need Meta). Client-safe — no DB, no config imports.
 */
import type { AdsHealth } from "@/lib/ads/ads-health";
import type { AdPerformanceRow } from "@/lib/analysis/ad-performance";
import type { MetaReportingStatus, ReportedLead } from "@/lib/meta/reporting-status";
import type { AdRecommendationRow } from "@/lib/ads/assemble";
import { normalizeAdId } from "@/lib/ads/ad-id";

export interface TodoItem {
  key: string;
  title: string;
  detail: string;
  /** Which sub-view explains/fixes it. */
  target: "meta" | "ads" | "google-health";
}

const ils = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;

/** Server-side part of the list: broken connections and deals Meta never got. */
export function buildServerTodo(
  health: AdsHealth | null,
  reporting: MetaReportingStatus | null,
): TodoItem[] {
  const items: TodoItem[] = [];
  if (!health) {
    items.push({
      key: "health-unknown",
      title: "לא הצלחתי לבדוק את מצב החיבורים",
      detail: "נסה לרענן את הדף. אם זה חוזר, החיבורים למטא לא נבדקו.",
      target: "meta",
    });
  } else {
    for (const c of health.checks.filter((c) => !c.ok)) {
      items.push({ key: `health-${c.key}`, title: `${c.label} — לא תקין`, detail: c.detail, target: "meta" });
    }
  }
  for (const r of reporting?.purchases ?? []) {
    if (r.state === "sent" || r.state === "not_from_meta") continue;
    const value = r.valueIls ? `, ${ils(r.valueIls)}` : "";
    const what =
      r.state === "pending" ? "עדיין לא דווחה למטא" : r.state === "failed" ? "נכשלה בדיווח למטא" : "חסר לה מזהה מודעה";
    items.push({
      key: `purchase-${r.name}`,
      title: `עסקה של ${r.name}${value} ${what}`,
      detail: r.note ?? "הפירוט המלא בלשונית ״דיווח למטא״.",
      target: "meta",
    });
  }
  return items;
}

/** Google side: every red line of the Google status list. Pure. */
export function buildGoogleTodo(health: AdsHealth | null): TodoItem[] {
  if (!health) {
    return [{ key: "g-health-unknown", title: "לא הצלחתי לבדוק את החיבורים לגוגל", detail: "נסה לרענן את הדף.", target: "google-health" }];
  }
  return health.checks
    .filter((c) => !c.ok)
    .map((c) => ({ key: `g-${c.key}`, title: `${c.label} — לא תקין`, detail: c.detail, target: "google-health" as const }));
}

/** Client-side part: needs the recommendations report (Meta). */
export function buildRecommendationTodo(
  rows: AdRecommendationRow[],
  structureWarnings: string[],
  metaOk: boolean,
  metaReason: string | null,
): TodoItem[] {
  const items: TodoItem[] = [];
  if (!metaOk) {
    items.push({
      key: "meta-down",
      title: "אין נתוני הוצאה ממטא — ההמלצות לא אמינות כרגע",
      detail: metaReason ?? "המספרים מה-CRM (לידים, עסקאות) עדיין נכונים.",
      target: "ads",
    });
  }
  const conflicts = rows.filter((r) => r.conflict);
  if (conflicts.length > 0) {
    items.push({
      key: "conflicts",
      title:
        conflicts.length === 1
          ? `ההחלטה שלך על ${conflicts[0].adName || conflicts[0].adId} סותרת את ההמלצה`
          : `${conflicts.length} מודעות שההחלטה שלך סותרת את ההמלצה`,
      detail: "פתח את המודעה ובדוק אם לעדכן את ההחלטה.",
      target: "ads",
    });
  }
  structureWarnings.forEach((w, i) => items.push({ key: `structure-${i}`, title: w, detail: "אזהרה בלבד — שום דבר לא נעצר.", target: "ads" }));
  return items;
}

/** "1 מכל 21" — how often a lead turns into X. Null when X never happened. */
export function oneIn(part: number, whole: number): string | null {
  if (part <= 0 || whole <= 0) return null;
  return `1 מכל ${Math.round(whole / part).toLocaleString("he-IL")}`;
}

export interface OverviewRow {
  /** Stable React key. */
  key: string;
  adName: string;
  campaignName: string | null;
  leads: number;
  markedGood: number;
  won: number;
  revenueIls: number;
  dealCustomers: string[];
  goodLeadNames: string[];
  /** Matched recommendation (by Ad ID); the highest-spend copy. */
  rec: AdRecommendationRow | null;
  /** Meta copies (Ad IDs) behind this name that have a recommendation. */
  recCount: number;
  /** Brought a deal, revenue or a good lead — stays visible; the rest folds. */
  leading: boolean;
}

export type OverviewSort = "revenue" | "won" | "good" | "leads";

/**
 * One row per ad NAME (the lead-quality report's unit), enriched with the
 * per-Ad-ID recommendations behind it — joined by normalized Ad ID, never by
 * name (docs/agent/meta-and-leads-intake.md). When a name covers several Meta
 * copies, the pill shows the copy that spent the most. Ads Meta spent on that
 * brought no lead at all appear too (exactly what "early stop" is about); ads
 * that never spent and carry no decision are left out as noise.
 */
export function mergeOverviewRows(
  perf: AdPerformanceRow[],
  recs: AdRecommendationRow[] | null,
): OverviewRow[] {
  const byId = new Map<string, AdRecommendationRow>();
  for (const r of recs ?? []) {
    const id = normalizeAdId(r.adId);
    if (id) byId.set(id, r);
  }
  const used = new Set<string>();
  const rows: OverviewRow[] = perf.map((p) => {
    const matched = p.adIds
      .map((id) => normalizeAdId(id))
      .filter((id): id is string => !!id && byId.has(id))
      .map((id) => {
        used.add(id);
        return byId.get(id)!;
      })
      .sort((a, b) => b.recommendation.metrics.spendIls - a.recommendation.metrics.spendIls);
    return {
      key: `n:${p.adName}`,
      adName: p.adName,
      campaignName: p.campaignName,
      leads: p.leads,
      markedGood: p.markedGood,
      won: p.won,
      revenueIls: p.revenueIls,
      dealCustomers: p.dealCustomers,
      goodLeadNames: p.goodLeadNames.map((n) => n.split("|")[0].trim()),
      rec: matched[0] ?? null,
      recCount: matched.length,
      leading: p.revenueIls > 0 || p.won > 0 || p.markedGood > 0,
    };
  });
  for (const [id, r] of byId) {
    if (used.has(id)) continue;
    const spent = r.recommendation.metrics.spendIls > 0;
    if (!spent && r.crmLeads === 0 && r.approvedStatus === "untested") continue;
    rows.push({
      key: `id:${id}`,
      adName: r.adName || r.adId,
      campaignName: r.campaignName,
      leads: r.crmLeads,
      markedGood: 0,
      won: r.deals,
      revenueIls: r.dealRevenueExVat,
      dealCustomers: r.dealCustomers,
      goodLeadNames: [],
      rec: r,
      recCount: 1,
      leading: r.deals > 0 || r.dealRevenueExVat > 0,
    });
  }
  return rows;
}

export function sortOverviewRows(rows: OverviewRow[], by: OverviewSort): OverviewRow[] {
  const val = (r: OverviewRow) =>
    by === "revenue" ? r.revenueIls : by === "won" ? r.won : by === "good" ? r.markedGood : r.leads;
  return [...rows].sort((a, b) => val(b) - val(a) || b.revenueIls - a.revenueIls || b.leads - a.leads);
}

export interface ReportGroups {
  /** Came from Meta but did not reach it — someone should look. */
  attention: ReportedLead[];
  sent: ReportedLead[];
  /** Never came from an ad — nothing to report; folded away. */
  notFromMeta: ReportedLead[];
}

const ATTENTION_ORDER: Record<string, number> = { failed: 0, no_meta_id: 1, pending: 2 };

/** "דיווח למטא": problems first (failed → missing id → pending), then what
 *  was sent (highest value first), and the not-from-an-ad rows last. Pure. */
export function groupReportRows(rows: ReportedLead[]): ReportGroups {
  const byValue = (a: { valueIls?: number }, b: { valueIls?: number }) => (b.valueIls ?? 0) - (a.valueIls ?? 0);
  return {
    attention: rows
      .filter((r) => r.state in ATTENTION_ORDER)
      .sort((a, b) => ATTENTION_ORDER[a.state] - ATTENTION_ORDER[b.state] || byValue(a, b)),
    sent: rows.filter((r) => r.state === "sent").sort(byValue),
    notFromMeta: rows.filter((r) => r.state === "not_from_meta").sort(byValue),
  };
}

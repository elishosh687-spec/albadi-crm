/**
 * Join Meta evidence, CRM evidence and Eli's approved review state by exact
 * Ad ID, run the engine per row, and describe data health. Pure — the server
 * wrapper (build-recommendations.ts) loads the inputs.
 *
 * An Ad ID present on only ONE side still gets a row: a CRM-only ID is exactly
 * the case that must say "לא ניתן להכריע" instead of quietly vanishing.
 */
import { recommend, type Recommendation, type RecommendationCode } from "./recommendation-engine";
import type { AdRecommendationSettings } from "./recommendation-settings";
import type { MetaAd, MetaSnapshot } from "./meta-evidence";
import type { CrmEvidence } from "./crm-evidence";
import type { ApprovedStatus, ReviewState } from "./review-state";
import { checkStructure, type AdRole, type AdSegment, type StructureReport } from "./structure-check";

export interface AdRecommendationRow {
  adId: string;
  adName: string;
  adSetId: string | null;
  adSetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** Meta effective_status, read-only. Null when Meta is unavailable/unknown. */
  effectiveStatus: string | null;
  segment: AdSegment | null;
  role: AdRole | null;
  approvedStatus: ApprovedStatus;
  approvedReason: string | null;
  approvedAt: string | null;
  crmLeads: number;
  suitableLeads: number | null;
  deals: number;
  dealRevenueExVat: number;
  dealCustomers: string[];
  recommendation: Recommendation;
  /** Non-blocking warnings shown beside the row. */
  warnings: string[];
  /** The live recommendation disagrees with Eli's approved status. */
  conflict: string | null;
}

export interface DataHealth {
  meta: { ok: boolean; configured: boolean; reason: string | null; fetchedAt: string; rows: number };
  unattributedLeads: number;
  nameCollisions: { name: string; adIds: string[] }[];
  /** Ad IDs the CRM has leads for but Meta does not know (only when Meta is ok). */
  unknownToMeta: string[];
}

export interface RecommendationsReport {
  policyRevision: number;
  today: string;
  rows: AdRecommendationRow[];
  counts: Partial<Record<RecommendationCode, number>>;
  structure: StructureReport;
  health: DataHealth;
}

const WINNER_LIKE: RecommendationCode[] = ["winner_candidate"];
const PROGRESSING: RecommendationCode[] = ["first_gate_pass", "stability_test", "continue_to_deal_proof", "winner_candidate"];

/** When the live recommendation contradicts the approved status — shown, never applied. */
export function conflictBetween(approved: ApprovedStatus, code: RecommendationCode): string | null {
  if (code === "insufficient_or_conflicting_data") return null;
  if (approved === "winner" && !WINNER_LIKE.includes(code)) {
    return code === "deal_economics_review"
      ? "מאושרת כמנצחת, אבל ה-CAC מעל היעד"
      : "מאושרת כמנצחת, אבל ההמלצה החיה אינה מנצחת";
  }
  if (approved === "loser" && PROGRESSING.includes(code)) {
    return "מאושרת כמפסידה, אבל ההמלצה החיה מתקדמת";
  }
  if (approved === "testing" && WINNER_LIKE.includes(code)) return "מועמדת למנצחת — עדיין לא אושרה";
  if (approved === "testing" && code === "loser_candidate") return "מועמדת למפסידה — עדיין לא אושרה";
  if (approved === "untested" && code !== "untested") return "קיבלה הוצאה אבל מסומנת כלא נוסתה";
  return null;
}

export function assembleRecommendations(input: {
  settings: AdRecommendationSettings;
  policyRevision: number;
  today: string;
  meta: MetaSnapshot;
  crm: CrmEvidence;
  review: ReviewState[];
}): RecommendationsReport {
  const { settings, meta, crm, today } = input;
  const reviewById = new Map(input.review.map((r) => [r.adId, r]));
  const metaAds: Map<string, MetaAd> = meta.ok ? meta.ads : new Map();

  const ids = new Set<string>([...metaAds.keys(), ...crm.byAdId.keys(), ...reviewById.keys()]);
  const collisionByName = crm.nameCollisions;
  const unknownToMeta: string[] = [];

  const rows: AdRecommendationRow[] = [];
  for (const adId of ids) {
    const m = metaAds.get(adId);
    const c = crm.byAdId.get(adId);
    const rv = reviewById.get(adId);
    const identityIssues: string[] = [];
    const warnings: string[] = [];

    if (!meta.ok) {
      identityIssues.push(`אין נתוני מטא: ${meta.reason}`);
    } else if (!m && c) {
      identityIssues.push("ב-CRM יש לידים עם ה-Ad ID הזה, אבל מטא לא מכירה אותו — ייתכן שהמודעה נמחקה או שהשיוך שגוי");
      unknownToMeta.push(adId);
    }

    const adName = m?.adName || c?.adNames[0] || "";
    for (const name of new Set([adName, ...(c?.adNames ?? [])])) {
      const others = (collisionByName.get(name) ?? []).filter((x) => x !== adId);
      if (others.length) {
        warnings.push(`לשם "${name}" יש עוד Ad ID: ${others.join(", ")} — כל עותק נמדד בנפרד`);
      }
    }
    if (m && c && m.daily.length) {
      const metaLeads = m.daily.reduce((a, d) => a + d.metaLeads, 0);
      if (metaLeads !== c.leads) warnings.push(`מטא סופרת ${metaLeads} לידים, ב-CRM משויכים ${c.leads}`);
    }

    const recommendation = recommend(
      {
        adId,
        daily: m?.daily ?? [],
        dailyHistoryComplete: meta.ok,
        crmLeads: c?.leads ?? 0,
        suitableLeads: c ? c.suitableLeads : 0,
        deals: c?.deals ?? 0,
        identityIssues,
      },
      settings,
      today,
    );
    const approvedStatus = rv?.approvedStatus ?? "untested";

    rows.push({
      adId,
      adName,
      adSetId: m?.adSetId ?? rv?.adSetId ?? null,
      adSetName: m?.adSetName ?? null,
      campaignId: m?.campaignId ?? null,
      campaignName: m?.campaignName ?? null,
      effectiveStatus: m?.effectiveStatus ?? null,
      segment: rv?.segment ?? null,
      role: rv?.role ?? null,
      approvedStatus,
      approvedReason: rv?.decisionReason ?? null,
      approvedAt: rv?.decidedAt ?? null,
      crmLeads: c?.leads ?? 0,
      suitableLeads: c ? c.suitableLeads : 0,
      deals: c?.deals ?? 0,
      dealRevenueExVat: c?.dealRevenueExVat ?? 0,
      dealCustomers: c?.dealCustomers ?? [],
      recommendation,
      warnings,
      conflict: conflictBetween(approvedStatus, recommendation.code),
    });
  }

  rows.sort(
    (a, b) =>
      b.recommendation.metrics.spendIls - a.recommendation.metrics.spendIls ||
      a.adName.localeCompare(b.adName) ||
      a.adId.localeCompare(b.adId),
  );

  const counts: Partial<Record<RecommendationCode, number>> = {};
  for (const r of rows) counts[r.recommendation.code] = (counts[r.recommendation.code] ?? 0) + 1;

  return {
    policyRevision: input.policyRevision,
    today,
    rows,
    counts,
    structure: checkStructure(
      rows.map((r) => ({ adId: r.adId, adName: r.adName, segment: r.segment, role: r.role, effectiveStatus: r.effectiveStatus })),
      settings,
    ),
    health: {
      meta: meta.ok
        ? { ok: true, configured: true, reason: null, fetchedAt: meta.fetchedAt, rows: meta.rows }
        : { ok: false, configured: meta.configured, reason: meta.reason, fetchedAt: meta.fetchedAt, rows: 0 },
      unattributedLeads: crm.unattributable.length,
      nameCollisions: [...crm.nameCollisions].map(([name, adIds]) => ({ name, adIds })),
      unknownToMeta,
    },
  };
}

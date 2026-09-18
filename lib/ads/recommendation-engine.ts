/**
 * Deterministic recommendation for ONE exact Meta Ad ID.
 *
 * Pure: evidence + policy + today's date in, a closed code + gate + ordered
 * Hebrew reasons out. No DB, no network, no clock — the caller passes `today`.
 * Client-safe, so the settings screen can re-run it on unsaved values.
 *
 * Recommendation only. Nothing here (or anything that calls it) may change a
 * Meta object; the approved manual status is separate state that this never
 * reads or writes.
 *
 * Gates are judged where the CUMULATIVE spend crossed them, from Meta's daily
 * rows — "at ₪100 we expect ~8 leads" (tests.md) means the leads the ad had at
 * ₪100, not everything it collected later. Daily granularity: the crossing day
 * is included whole.
 *
 * Decisions compare in agorot (integers); rounding happens only for display.
 *
 * Design: docs/plans/2026-09-18-meta-ad-recommendations-settings-design.md
 */
import type { AdRecommendationSettings } from "./recommendation-settings";

export type RecommendationCode =
  | "untested"
  | "collecting"
  | "first_gate_pass"
  | "quality_review"
  | "early_stop"
  | "stability_test"
  | "continue_to_deal_proof"
  | "stop_after_stability"
  | "pause_and_mature"
  | "winner_candidate"
  | "deal_economics_review"
  | "loser_candidate"
  | "insufficient_or_conflicting_data";

export type TestingGate = "none" | "first" | "stability" | "deal_proof";

export const RECOMMENDATION_LABELS: Record<RecommendationCode, string> = {
  untested: "לא נוסתה",
  collecting: "אוספת נתונים",
  first_gate_pass: "עברה סינון ראשוני",
  quality_review: "דורשת בדיקת איכות",
  early_stop: "מומלץ לעצור מוקדם",
  stability_test: "בבדיקת יציבות",
  continue_to_deal_proof: "להמשיך להוכחת עסקה",
  stop_after_stability: "מומלץ לעצור אחרי בדיקת יציבות",
  pause_and_mature: "לעצור הוצאה ולהמתין להבשלה",
  winner_candidate: "מועמדת למנצחת",
  deal_economics_review: "יש עסקה — לבדוק כלכליות",
  loser_candidate: "מועמדת למפסידה",
  insufficient_or_conflicting_data: "לא ניתן להכריע",
};

export interface DailyRow {
  /** Calendar date, YYYY-MM-DD (ad-account timezone). */
  date: string;
  spendIls: number;
  /** Meta `action_type = lead` only. */
  metaLeads: number;
}

export interface AdEvidence {
  adId: string;
  /** Meta's daily rows for this Ad ID, any order. */
  daily: DailyRow[];
  /** False when Meta paging failed or the history may be clipped. */
  dailyHistoryComplete: boolean;
  /** Leads in the CRM attributed to this Ad ID (display + mismatch warning). */
  crmLeads: number;
  /** CRM leads carrying the configured GHL tag. Null = unavailable. */
  suitableLeads: number | null;
  /** Closed deals in the CRM attributed to this Ad ID. Authoritative. */
  deals: number;
  /** Blocking identity/attribution problems (missing ID, conflicting rows…). */
  identityIssues: string[];
}

export interface Reason {
  key: string;
  text: string;
}

export interface AdMetrics {
  spendIls: number;
  metaLeads: number;
  deliveryDays: number;
  firstSpendDate: string | null;
  lastSpendDate: string | null;
  cplIls: number | null;
  cacIls: number | null;
  contributionAfterAdsIls: number | null;
  /** Leads at the moment the cumulative spend crossed each gate. */
  leadsAtFirstGate: number | null;
  spendAtFirstGateIls: number | null;
  leadsAtStability: number | null;
  spendAtStabilityIls: number | null;
  daysSinceLastSpend: number | null;
}

export interface Recommendation {
  code: RecommendationCode;
  label: string;
  gate: TestingGate;
  reasons: Reason[];
  metrics: AdMetrics;
}

const ag = (ils: number) => Math.round(ils * 100);
const ils = (n: number) =>
  `₪${(Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Whole calendar days from `from` to `to` (YYYY-MM-DD), timezone-free. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

interface Crossing {
  spendAg: number;
  leads: number;
  date: string;
}

/** First day on which cumulative spend reached `gateAg`, with totals through it. */
function crossing(sorted: DailyRow[], gateAg: number): Crossing | null {
  let spendAg = 0;
  let leads = 0;
  for (const d of sorted) {
    spendAg += ag(d.spendIls);
    leads += d.metaLeads;
    if (spendAg >= gateAg) return { spendAg, leads, date: d.date };
  }
  return null;
}

/** spend / leads ≤ target, in integers (no float boundary error). */
const cplWithin = (spendAg: number, leads: number, targetAg: number) =>
  leads > 0 && spendAg <= targetAg * leads;

export function computeMetrics(
  ev: AdEvidence,
  s: AdRecommendationSettings,
  today: string,
): AdMetrics {
  const sorted = [...ev.daily].sort((a, b) => a.date.localeCompare(b.date));
  const spendDays = sorted.filter((d) => ag(d.spendIls) > 0);
  const spendAg = sorted.reduce((a, d) => a + ag(d.spendIls), 0);
  const spendIls = spendAg / 100;
  const metaLeads = sorted.reduce((a, d) => a + d.metaLeads, 0);
  const first = crossing(sorted, ag(s.gates.firstGateSpendIls));
  const stab = crossing(sorted, ag(s.gates.stabilitySpendIls));
  const last = spendDays.at(-1)?.date ?? null;
  return {
    spendIls,
    metaLeads,
    deliveryDays: spendDays.length,
    firstSpendDate: spendDays[0]?.date ?? null,
    lastSpendDate: last,
    cplIls: metaLeads > 0 ? spendIls / metaLeads : null,
    cacIls: ev.deals > 0 ? spendIls / ev.deals : null,
    contributionAfterAdsIls: ev.deals * s.economics.contributionProfitIls - spendIls,
    leadsAtFirstGate: first?.leads ?? null,
    spendAtFirstGateIls: first ? first.spendAg / 100 : null,
    leadsAtStability: stab?.leads ?? null,
    spendAtStabilityIls: stab ? stab.spendAg / 100 : null,
    daysSinceLastSpend: last ? daysBetween(last, today) : null,
  };
}

export function recommend(
  ev: AdEvidence,
  s: AdRecommendationSettings,
  today: string,
): Recommendation {
  const m = computeMetrics(ev, s, today);
  const reasons: Reason[] = [];
  const out = (code: RecommendationCode, gate: TestingGate): Recommendation => ({
    code,
    label: RECOMMENDATION_LABELS[code],
    gate,
    reasons,
    metrics: m,
  });
  const say = (key: string, text: string) => reasons.push({ key, text });

  const e = s.economics;
  const g = s.gates;
  const spendAg = ag(m.spendIls);
  const targetCplAg = ag(e.targetCplIls);

  // 1. Identity / evidence. A data problem never produces a verdict.
  if (ev.identityIssues.length > 0) {
    for (const issue of ev.identityIssues) say("identity", issue);
    return out("insufficient_or_conflicting_data", "none");
  }
  if (!ev.dailyHistoryComplete) {
    say(
      "history_incomplete",
      "היסטוריית ההוצאה היומית ממטא חלקית, ולכן אי אפשר לקבוע שערים, ימי מסירה או הבשלה.",
    );
    return out("insufficient_or_conflicting_data", "none");
  }
  if (ev.daily.some((d) => !(d.spendIls >= 0) || !(d.metaLeads >= 0))) {
    say("bad_rows", "יש בנתוני מטא שורה עם הוצאה או לידים שליליים או חסרים.");
    return out("insufficient_or_conflicting_data", "none");
  }

  if (spendAg === 0) {
    say("no_spend", "למודעה אין הוצאה בפועל.");
    return out("untested", "none");
  }

  const cplText =
    m.cplIls !== null
      ? `הוצאה ${ils(m.spendIls)}, ${m.metaLeads} לידים, CPL ${ils(m.cplIls)}.`
      : `הוצאה ${ils(m.spendIls)}, 0 לידים.`;
  say("summary", cplText);

  // 2. A real CRM deal is judged before anything CPL-based.
  const dealVerdict = (): Recommendation | null => {
    if (ev.deals <= 0) return null;
    const cacOk = ag(m.cacIls!) <= ag(e.maxCacIls);
    const v = s.verdict;
    say(
      "deals",
      `${ev.deals} עסקאות ב-CRM, CAC ${ils(m.cacIls!)} (יעד עד ${ils(e.maxCacIls)}), רווח אחרי פרסום ${ils(m.contributionAfterAdsIls!)}.`,
    );
    if (v.winnerRequiresCacAtOrBelowTarget && !cacOk) {
      say("cac_over", "יש עסקה אבל ה-CAC מעל היעד — לבדוק את כלכליות העסקה לפני הכרעה.");
      return out("deal_economics_review", "deal_proof");
    }
    if (ev.deals >= v.winnerMinDeals) {
      say("winner", "מספיק עסקאות וה-CAC עומד ביעד. זו המלצה בלבד עד שתשמור סטטוס מאושר.");
      return out("winner_candidate", "deal_proof");
    }
    say(
      "deal_below_min",
      `יש עסקה, אבל למועמדת למנצחת נדרשות ${v.winnerMinDeals}. העסקה גוברת על עצירה לפי CPL.`,
    );
    return out("continue_to_deal_proof", "deal_proof");
  };

  if (e.dealOverridesCplStop) {
    const r = dealVerdict();
    if (r) return r;
  }

  // 3. Final paid-testing gate without a deal (with a deal we returned above
  //    when deals override; otherwise they are judged after the CPL rules).
  if (spendAg >= ag(g.dealProofSpendIls) && ev.deals === 0) {
    const days = m.daysSinceLastSpend ?? 0;
    if (s.verdict.loserRequiresMaturation && days < g.maturationDays) {
      say(
        "maturing",
        `הגיעה ל-${ils(g.dealProofSpendIls)} בלי עסקה. יום הוצאה אחרון ${m.lastSpendDate}, עברו ${days} מתוך ${g.maturationDays} ימי הבשלה — לעצור הוצאה ולהמשיך לטפל בלידים.`,
      );
      return out("pause_and_mature", "deal_proof");
    }
    say(
      "loser",
      `הגיעה ל-${ils(g.dealProofSpendIls)} בלי עסקה${s.verdict.loserRequiresMaturation ? ` ועברו ${days} ימים מאז ההוצאה האחרונה` : ""}. זו המלצה בלבד עד שתשמור סטטוס מאושר.`,
    );
    return out("loser_candidate", "deal_proof");
  }

  const q = s.suitableLead;
  const overrideOn = q.allowQualityOverride && q.qualityOverrideMinSuitable !== null;
  const qualityPasses =
    overrideOn && ev.suitableLeads !== null && ev.suitableLeads >= q.qualityOverrideMinSuitable!;
  const suitableText =
    ev.suitableLeads === null
      ? "נתוני לידים מתאימים אינם זמינים."
      : `${ev.suitableLeads} לידים מתאימים (תגית "${q.tag}").`;

  const cplRule = (): Recommendation => {
    // 4. Stability gate.
    if (m.leadsAtStability !== null) {
      const stabSpendAg = ag(m.spendAtStabilityIls!);
      if (cplWithin(stabSpendAg, m.leadsAtStability, targetCplAg)) {
        say(
          "stability_pass",
          `בשער היציבות (${ils(m.spendAtStabilityIls!)}) היו ${m.leadsAtStability} לידים — CPL ${ils(m.spendAtStabilityIls! / m.leadsAtStability)}, עד היעד ${ils(e.targetCplIls)}.`,
        );
        return out("continue_to_deal_proof", "stability");
      }
      if (qualityPasses) {
        say("stability_quality", `ה-CPL בשער היציבות מעל היעד, אבל ${suitableText} עוקף לפי ההגדרה.`);
        return out("continue_to_deal_proof", "stability");
      }
      const cpl = m.leadsAtStability > 0 ? `CPL ${ils(m.spendAtStabilityIls! / m.leadsAtStability)}` : "אין לידים";
      say(
        "stability_fail",
        `בשער היציבות (${ils(m.spendAtStabilityIls!)}) היו ${m.leadsAtStability} לידים — ${cpl}, מעל היעד ${ils(e.targetCplIls)}.`,
      );
      return out("stop_after_stability", "stability");
    }

    // 5. First gate.
    if (m.leadsAtFirstGate !== null) {
      const n = m.leadsAtFirstGate;
      const at = `בשער הראשון (${ils(m.spendAtFirstGateIls!)}) היו ${n} לידים`;
      if (n <= g.firstGateStopMax) {
        say("first_stop", `${at}; ${g.firstGateStopMax} ומטה מצדיקים עצירה מוקדמת (יעד CPL ${ils(e.targetCplIls)}).`);
        return out("early_stop", "first");
      }
      const passed = n >= g.firstGatePassLeads;
      if (!passed && !qualityPasses) {
        say(
          "first_review",
          `${at} — בטווח ${g.firstGateReviewMin}–${g.firstGatePassLeads - 1} שדורש בדיקת איכות. ${suitableText} המעבר לבדיקת יציבות הוא החלטה שלך.`,
        );
        return out("quality_review", "first");
      }
      say(
        passed ? "first_pass" : "first_quality",
        passed
          ? `${at}; ${g.firstGatePassLeads} ומעלה עוברים.`
          : `${at} — בטווח הבדיקה, אבל ${suitableText} עוקף לפי ההגדרה.`,
      );
      const spentAfterCrossing = spendAg > ag(m.spendAtFirstGateIls!);
      if (spentAfterCrossing) {
        say("in_stability", `ממשיכה עד ${ils(g.stabilitySpendIls)} לבדיקת יציבות.`);
        return out("stability_test", "stability");
      }
      say("to_stability", `אפשר להעלות לבדיקת יציבות עד ${ils(g.stabilitySpendIls)}.`);
      return out("first_gate_pass", "first");
    }

    // 6. Still collecting.
    const left = g.firstGateSpendIls - m.spendIls;
    const days = Math.ceil(left / g.referenceDailyBudgetIls);
    say(
      "collecting",
      `עוד ${ils(left)} עד הסינון הראשוני (${ils(g.firstGateSpendIls)}) — כ-${days} ימי מסירה ב-${ils(g.referenceDailyBudgetIls)} ליום.`,
    );
    return out("collecting", "none");
  };

  const r = cplRule();
  if (!e.dealOverridesCplStop) {
    // Deals do not override: a CPL stop stands; otherwise the deal decides.
    if (r.code === "early_stop" || r.code === "stop_after_stability") return r;
    const d = dealVerdict();
    if (d) return d;
  }
  return r;
}

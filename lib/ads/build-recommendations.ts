/**
 * Server entry: load policy + Meta + CRM + review state and assemble the
 * recommendations. Used by the widget API and by the daily health job, so the
 * job checks exactly what the screen shows.
 */
import { logger } from "@/lib/observability/log";
import { assembleRecommendations, type RecommendationsReport } from "./assemble";
import { fetchMetaEvidence } from "./meta-evidence";
import { loadCrmEvidence } from "./crm-evidence";
import { listReviewState } from "./review-state-store";
import { getAdRecommendationPolicy } from "./settings-store";

const log = logger("meta");

/** Today's calendar date in Israel — the ad account's timezone. */
export function todayInIsrael(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

export async function buildRecommendations(opts: { fresh?: boolean } = {}): Promise<RecommendationsReport> {
  const today = todayInIsrael();
  const policy = await getAdRecommendationPolicy();
  const [meta, crm, review] = await Promise.all([
    fetchMetaEvidence({ today, fresh: opts.fresh }),
    loadCrmEvidence(policy.settings.suitableLead.tag),
    listReviewState(),
  ]);
  const report = assembleRecommendations({
    settings: policy.settings,
    policyRevision: policy.revision,
    today,
    meta,
    crm,
    review,
  });

  if (!meta.ok) {
    log.warn("ads_evidence.meta_unavailable", { configured: meta.configured, reason: meta.reason });
  }
  if (report.health.unattributedLeads || report.health.unknownToMeta.length || report.health.nameCollisions.length) {
    log.info("ads_evidence.identity_warnings", {
      unattributedLeads: report.health.unattributedLeads,
      unknownToMeta: report.health.unknownToMeta.length,
      nameCollisions: report.health.nameCollisions.length,
    });
  }
  log.info("ads_recommendations.computed", {
    revision: report.policyRevision,
    rows: report.rows.length,
    counts: report.counts,
    conflicts: report.rows.filter((r) => r.conflict).length,
    structureWarnings: report.structure.warnings.length,
  });
  return report;
}

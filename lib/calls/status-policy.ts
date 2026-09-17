import type { BotSettings } from "../bot-settings/schema";
import type { CallAnalysisV2, RecommendedCallStatus } from "./analysis-v2";
import { hasValidEvidence } from "./evidence";

export type StatusDecision = "off" | "recommend" | "needs_approval" | "automatic" | "blocked";

export interface StatusPolicyResult {
  decision: StatusDecision;
  status: RecommendedCallStatus;
  reason: string;
}

export function isExplicitLostEvidence(analysis: CallAnalysisV2): boolean {
  const recommendation = analysis.outcome.statusRecommendation;
  if (recommendation?.status !== "lost" || !hasValidEvidence(recommendation.evidence)) return false;
  const quote = recommendation.evidence.quote ?? "";
  return /(לא\s*מעוניי|לא\s*רוצה|סגרתי\s+עם|בחרתי\s+ב|ספק\s+אחר|אל\s+תחזר|תפסיק|להסיר)/i.test(quote);
}

function configuredMode(status: RecommendedCallStatus, settings: BotSettings): string {
  if (status === "negotiation") return settings.callAnalysisNegotiationStatusMode;
  if (status === "future_follow_up") return settings.callAnalysisFutureStatusMode;
  if (status === "won") return settings.callAnalysisWonStatusMode;
  if (status === "lost") return settings.callAnalysisLostStatusMode;
  return "off";
}

export function evaluateStatusRecommendation(args: {
  analysis: CallAnalysisV2;
  settings: BotSettings;
  noResponseCallCount?: number;
  noResponseWhatsappCount?: number;
  explicitLostSignal?: boolean;
}): StatusPolicyResult | null {
  const recommendation = args.analysis.outcome.statusRecommendation;
  if (!recommendation || recommendation.status === "no_change") return null;
  const status = recommendation.status;
  if (!hasValidEvidence(recommendation.evidence)) {
    return { decision: "blocked", status, reason: "evidence_missing" };
  }
  if (
    status === "lost" &&
    !args.explicitLostSignal &&
    ((args.noResponseCallCount ?? 0) < 3 || (args.noResponseWhatsappCount ?? 0) < 3)
  ) {
    return { decision: "blocked", status, reason: "lost_history_threshold_not_met" };
  }
  const mode = configuredMode(status, args.settings);
  if (mode === "off") return { decision: "off", status, reason: "status_mode_off" };
  if (mode === "approve") return { decision: "needs_approval", status, reason: "status_requires_approval" };
  if (mode === "automatic") {
    // Launch guard: status writes are not enabled during the task-quality pilot.
    return { decision: "recommend", status, reason: "sensitive_status_launch_guard" };
  }
  return { decision: "recommend", status, reason: "recommendation_only" };
}

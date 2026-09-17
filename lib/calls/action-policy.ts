import type { BotSettings } from "../bot-settings/schema";
import type { CallAnalysisV2, ProposedCallAction } from "./analysis-v2";
import { hasValidEvidence } from "./evidence";
import { parseActionTypes, toSalespersonFollowUp } from "./action-types";

export type CallActionDecision = "auto_create" | "needs_approval" | "no_action" | "blocked";

export type CallActionReason =
  | "task_mode_off"
  | "no_proposed_action"
  | "voicemail_or_short_call"
  | "action_not_concrete"
  | "owner_missing"
  | "due_missing"
  | "due_invalid"
  | "evidence_missing"
  | "confidence_below_threshold"
  | "action_requires_approval"
  | "action_not_allowed_automatically"
  | "duplicate"
  | "possible_duplicate"
  | "contradiction"
  | "shadow_mode"
  | "approve_all_mode"
  | "safe_for_automatic_creation";

export interface CallActionPolicyResult {
  decision: CallActionDecision;
  reason: CallActionReason;
  action: ProposedCallAction | null;
  resolvedDueAt: string | null;
  checks: {
    concreteAction: boolean;
    owner: boolean;
    dueTime: boolean;
    evidence: boolean;
    confidence: boolean;
    actionTypeAllowed: boolean;
    conflictFree: boolean;
  };
}

export type TaskConflict = "none" | "duplicate" | "possible_duplicate" | "contradiction";

type ActionSettings = Pick<
  BotSettings,
  | "callAnalysisTaskMode"
  | "callAnalysisConfidenceThreshold"
  | "callAnalysisEvidenceRequired"
  | "callAnalysisMissingDuePolicy"
  | "callAnalysisDefaultDueHours"
  | "callAnalysisAutoActionTypes"
  | "callAnalysisAlwaysApproveActionTypes"
>;

function result(
  decision: CallActionDecision,
  reason: CallActionReason,
  action: ProposedCallAction | null,
  resolvedDueAt: string | null,
  checks: CallActionPolicyResult["checks"],
): CallActionPolicyResult {
  return { decision, reason, action, resolvedDueAt, checks };
}

export function evaluateCallAction(args: {
  analysis: CallAnalysisV2;
  settings: ActionSettings;
  callStartedAt: Date;
  assigneeResolved: boolean;
  conflict?: TaskConflict;
}): CallActionPolicyResult {
  const emptyChecks = {
    concreteAction: false,
    owner: args.assigneeResolved,
    dueTime: false,
    evidence: false,
    confidence: false,
    actionTypeAllowed: false,
    conflictFree: (args.conflict ?? "none") === "none",
  };
  if (args.settings.callAnalysisTaskMode === "off") {
    return result("no_action", "task_mode_off", null, null, emptyChecks);
  }

  const proposed = args.analysis.outcome.proposedAction;
  if (!proposed) return result("no_action", "no_proposed_action", null, null, emptyChecks);
  const action = toSalespersonFollowUp(proposed);
  const checks = {
    ...emptyChecks,
    concreteAction: action.description.trim().length >= 4,
    evidence: !args.settings.callAnalysisEvidenceRequired || hasValidEvidence(action.evidence),
    confidence: action.confidence * 100 >= args.settings.callAnalysisConfidenceThreshold,
  };
  if (args.analysis.isVoicemail || args.analysis.isTooShortForAction) {
    return result("blocked", "voicemail_or_short_call", action, action.dueAt, checks);
  }
  if (!checks.concreteAction) return result("blocked", "action_not_concrete", action, null, checks);
  if (!checks.owner) return result("needs_approval", "owner_missing", action, action.dueAt, checks);

  let dueAt = action.dueAt;
  if (!dueAt && args.settings.callAnalysisMissingDuePolicy === "default_delay") {
    dueAt = new Date(
      args.callStartedAt.getTime() + args.settings.callAnalysisDefaultDueHours * 60 * 60 * 1000,
    ).toISOString();
  }
  checks.dueTime = Boolean(dueAt && !Number.isNaN(new Date(dueAt).getTime()));
  if (!checks.dueTime) {
    const decision = args.settings.callAnalysisMissingDuePolicy === "no_task" ? "blocked" : "needs_approval";
    return result(decision, "due_missing", action, null, checks);
  }
  if (!checks.evidence) return result("needs_approval", "evidence_missing", action, dueAt, checks);
  if (!checks.confidence) {
    return result("needs_approval", "confidence_below_threshold", action, dueAt, checks);
  }

  const conflict = args.conflict ?? "none";
  if (conflict === "duplicate") return result("no_action", "duplicate", action, dueAt, checks);
  if (conflict === "possible_duplicate") {
    return result("needs_approval", "possible_duplicate", action, dueAt, checks);
  }
  if (conflict === "contradiction") {
    return result("needs_approval", "contradiction", action, dueAt, checks);
  }

  const alwaysApprove = parseActionTypes(args.settings.callAnalysisAlwaysApproveActionTypes);
  if (alwaysApprove.has(action.actionType)) {
    return result("needs_approval", "action_requires_approval", action, dueAt, checks);
  }
  const autoAllowed = parseActionTypes(args.settings.callAnalysisAutoActionTypes);
  checks.actionTypeAllowed =
    args.settings.callAnalysisTaskMode === "automatic" || autoAllowed.has(action.actionType);
  if (!checks.actionTypeAllowed) {
    return result("needs_approval", "action_not_allowed_automatically", action, dueAt, checks);
  }
  if (args.settings.callAnalysisTaskMode === "shadow") {
    return result("needs_approval", "shadow_mode", action, dueAt, checks);
  }
  if (args.settings.callAnalysisTaskMode === "approve_all") {
    return result("needs_approval", "approve_all_mode", action, dueAt, checks);
  }
  if (!["hybrid", "automatic"].includes(args.settings.callAnalysisTaskMode)) {
    return result("needs_approval", "approve_all_mode", action, dueAt, checks);
  }
  return result("auto_create", "safe_for_automatic_creation", action, dueAt, checks);
}

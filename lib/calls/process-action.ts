import { getBotSettings } from "../bot-settings/store";
import { resolveTaskAssigneeByContact } from "../crm-tasks/assignee";
import type { CallAnalysisV2 } from "./analysis-v2";
import { evaluateCallAction } from "./action-policy";
import { ensureCallActionCandidate, type CallSource } from "./candidate-repository";
import { evaluateStatusRecommendation, isExplicitLostEvidence } from "./status-policy";
import { executeCallActionCandidate } from "./task-executor";
import { logger } from "../observability/log";

const log = logger("calls");

export async function processCallAction(args: {
  source: CallSource;
  sourceRecordId: string;
  leadSid?: string | null;
  ghlContactId: string;
  callStartedAt: Date | null;
  analysis: CallAnalysisV2;
}) {
  const settings = await getBotSettings();
  if (!settings.callAnalysisEnabled) return { candidate: null, execution: null };

  const assignedTo =
    settings.callAnalysisAssigneeMode === "fixed_user"
      ? settings.callAnalysisFixedAssigneeId.trim() || null
      : await resolveTaskAssigneeByContact(args.ghlContactId);
  const policy = evaluateCallAction({
    analysis: args.analysis,
    settings,
    callStartedAt: args.callStartedAt ?? new Date(args.analysis.metadata.callStartedAt),
    assigneeResolved: Boolean(assignedTo),
  });
  const statusPolicy = evaluateStatusRecommendation({
    analysis: args.analysis,
    settings,
    // Cumulative no-response history is deliberately not guessed here. Until
    // the history reader supplies it, LOST from silence remains blocked.
    noResponseCallCount: 0,
    noResponseWhatsappCount: 0,
    explicitLostSignal: isExplicitLostEvidence(args.analysis),
  });
  if (settings.callAnalysisTaskMode === "off" && !statusPolicy) {
    return { candidate: null, execution: null, policy, statusPolicy };
  }
  const candidate = await ensureCallActionCandidate({
    source: args.source,
    sourceRecordId: args.sourceRecordId,
    leadSid: args.leadSid,
    ghlContactId: args.ghlContactId,
    analysis: args.analysis,
    policy,
    statusPolicy,
  });
  log.info("call_action.candidate_evaluated", {
    source: args.source,
    sourceRecordId: args.sourceRecordId,
    candidateId: candidate?.id ?? null,
    decision: policy.decision,
    reason: policy.reason,
    actionType: policy.action?.actionType ?? null,
  });
  const execution =
    candidate && policy.decision === "auto_create"
      ? await executeCallActionCandidate(candidate.id)
      : null;
  if (execution) {
    if (execution.executed) {
      log.info("call_action.executed", {
        source: args.source,
        sourceRecordId: args.sourceRecordId,
        candidateId: candidate?.id ?? null,
        taskId: execution.taskId ?? null,
      });
    } else {
      log.warn("call_action.execution_failed", {
        source: args.source,
        sourceRecordId: args.sourceRecordId,
        candidateId: candidate?.id ?? null,
        reason: execution.reason ?? "unknown",
      });
    }
  }
  return { candidate, execution, policy, statusPolicy };
}

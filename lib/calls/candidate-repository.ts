import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { callActionCandidates } from "@/drizzle/schema";
import { db } from "@/lib/db";
import type { CallAnalysisV2 } from "./analysis-v2";
import type { CallActionPolicyResult } from "./action-policy";
import type { StatusPolicyResult } from "./status-policy";

export type CallSource = "ghl" | "elevenlabs";

function keyFor(args: {
  source: CallSource;
  sourceRecordId: string;
  analysis: CallAnalysisV2;
  policy: CallActionPolicyResult;
}): string {
  const actionType = args.policy.action?.actionType ?? "none";
  return createHash("sha256")
    .update(`${args.source}:${args.sourceRecordId}:${args.analysis.metadata.inputHash}:${actionType}`)
    .digest("hex");
}

function initialState(policy: CallActionPolicyResult): {
  status: string;
  executionStatus: string;
} {
  if (policy.decision === "auto_create") {
    return { status: "approved", executionStatus: "pending" };
  }
  if (policy.decision === "needs_approval") {
    return { status: "pending", executionStatus: "not_requested" };
  }
  return { status: "superseded", executionStatus: "not_requested" };
}

export async function ensureCallActionCandidate(args: {
  source: CallSource;
  sourceRecordId: string;
  leadSid?: string | null;
  ghlContactId?: string | null;
  analysis: CallAnalysisV2;
  policy: CallActionPolicyResult;
  statusPolicy?: StatusPolicyResult | null;
}) {
  const idempotencyKey = keyFor(args);
  const proposal = {
    action: args.policy.action,
    resolvedDueAt: args.policy.resolvedDueAt,
    checks: args.policy.checks,
    statusRecommendation: args.analysis.outcome.statusRecommendation,
    statusPolicy: args.statusPolicy ?? null,
    callSummary: args.analysis.call_summary,
  };
  const state = initialState(args.policy);
  await db
    .insert(callActionCandidates)
    .values({
      source: args.source,
      sourceRecordId: args.sourceRecordId,
      leadSid: args.leadSid ?? null,
      ghlContactId: args.ghlContactId ?? null,
      analysisVersion: args.analysis.schema_version,
      inputHash: args.analysis.metadata.inputHash,
      proposal,
      originalProposal: proposal,
      policyDecision: args.policy.decision,
      decisionReason: args.policy.reason,
      status: state.status,
      executionStatus: state.executionStatus,
      idempotencyKey,
    })
    .onConflictDoNothing({ target: callActionCandidates.idempotencyKey });

  const [candidate] = await db
    .select()
    .from(callActionCandidates)
    .where(
      and(
        eq(callActionCandidates.idempotencyKey, idempotencyKey),
        eq(callActionCandidates.source, args.source),
      ),
    )
    .limit(1);
  return candidate ?? null;
}

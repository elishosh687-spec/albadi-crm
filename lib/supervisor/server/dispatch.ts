/**
 * Supervisor routing — shared by bridge and Green API webhooks.
 *
 * Given an inbound message context, runs precomputeCandidate +
 * superviseIncomingMessage, applies the safe-autosend override, and dispatches:
 *
 *   - silence            → log no_op, do not reply
 *   - supervisor_error   → log no_op, fall through to legacy handler as safety net
 *   - escalate_to_eli    → generate draft + DM Eli, do NOT reply
 *   - override_with_text → send override text, do NOT run legacy handler
 *   - approve_code       → return { shouldRunLegacy: true } so caller runs handler
 *
 * Caller is responsible for running the legacy handler when shouldRunLegacy=true
 * and for logging the handler's eventual action.
 */

import { db } from "@/lib/db";
import { leads, messages as messagesTable } from "@/drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
import { precomputeCandidateAction } from "@/lib/supervisor/candidate";
import { superviseIncomingMessage } from "@/lib/supervisor/supervise";
import { logDecision } from "@/lib/supervisor/log";
import { generateAndQueueDraft } from "@/lib/drafts";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { sendEliDM } from "@/lib/notify/eli";

export interface DispatchInput {
  sid: string;
  bridgeJid: string;
  inboundMessageId: number | null;
  inboundText: string;
  stage: string | null;
  mediaPresent: boolean;
  botPaused: boolean;
  /** Inbound channel: 'bridge' | 'green' | 'ghl'. Defaults to 'bridge'. */
  source?: string;
}

export interface DispatchResult {
  shouldRunLegacy: boolean;
  /** Verdict echo so caller can pass into its legacy-handler logging path. */
  supervisor?: {
    intent: string | null;
    confidence: number | null;
    recommended: string;
    reason: string;
    riskFlags: string[];
    candidate: string;
    rawJson: string | null;
    replayMeta: Record<string, unknown>;
  };
}

async function loadRecent(
  sid: string
): Promise<{ direction: "in" | "out"; text: string }[]> {
  const rows = await db
    .select({
      direction: messagesTable.direction,
      text: messagesTable.text,
    })
    .from(messagesTable)
    .where(eq(messagesTable.manychatSubId, sid.trim()))
    .orderBy(desc(messagesTable.receivedAt))
    .limit(20);
  return rows
    .filter((r) => r.text && r.text.trim().length > 0)
    .map((r) => ({ direction: r.direction as "in" | "out", text: r.text! }))
    .reverse();
}

const SAFE_AUTOSEND_INTENTS = new Set([
  "samples_request",
  "question_delivery",
  "question_format",
  "question_company",
  "question_inclusive",
]);

export async function dispatchSupervisor(
  input: DispatchInput
): Promise<DispatchResult> {
  const { sid, bridgeJid, inboundMessageId, inboundText, stage, mediaPresent, botPaused, source = "bridge" } = input;

  if (!inboundText.trim()) {
    return { shouldRunLegacy: true };
  }

  const [freshLead] = await db
    .select({
      name: leads.name,
      phone: leads.phoneE164,
      qState: leads.qState,
      notes: leads.notes,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);

  const recent = await loadRecent(sid);
  const candidate = await precomputeCandidateAction({
    stage,
    inboundText,
    hasMedia: mediaPresent,
    qState: freshLead?.qState ?? null,
    recentMessages: recent,
    leadName: freshLead?.name ?? null,
  });

  const verdict = await superviseIncomingMessage({
    sid,
    jid: bridgeJid,
    inboundText,
    stage,
    qState: freshLead?.qState ?? null,
    recentMessages: recent,
    leadName: freshLead?.name ?? null,
    phone: freshLead?.phone ?? null,
    notes: freshLead?.notes ?? null,
    botPaused,
    candidate,
  });

  // Safe-autosend override — mirror bridge logic.
  if (
    verdict.recommended === "escalate_to_eli" &&
    !verdict.overrideText &&
    verdict.riskFlags.length === 0 &&
    candidate.kind === "canned_reply" &&
    candidate.intent &&
    SAFE_AUTOSEND_INTENTS.has(candidate.intent) &&
    (candidate.intentConfidence ?? 0) >= 0.85 &&
    (verdict.confidence ?? 0) < 0.6
  ) {
    verdict.recommended = "approve_code";
    verdict.reason = `auto_send_lane: ${candidate.intent} canned reply. Original: ${verdict.reason}`;
    verdict.riskFlags = [...verdict.riskFlags, "auto_send_override"];
  }

  const replayMeta = {
    prompt_version: verdict.promptVersion,
    model: verdict.model,
    candidate: {
      kind: candidate.kind,
      intent: candidate.intent,
      intent_confidence: candidate.intentConfidence,
      intent_summary: candidate.intentSummary,
      description: candidate.description,
      canned_reply_label: candidate.cannedReplyLabel ?? null,
    },
  };

  const logBase = {
    manychatSubId: sid,
    messageId: inboundMessageId,
    inboundText,
    stageBefore: stage,
    llmIntent: verdict.intent,
    llmConfidence: verdict.confidence,
    llmRecommended: verdict.recommended,
    llmReason: verdict.reason,
    llmRiskFlags: verdict.riskFlags,
    source,
  };

  if (verdict.recommended === "supervisor_error") {
    await logDecision({
      ...logBase,
      decidedBy: "supervisor_error",
      action: "no_op",
      metadata: { ...replayMeta, rawJson: verdict.rawJson },
    });
    // Fall through to legacy as safety — without supervisor, code must answer.
    return {
      shouldRunLegacy: true,
      supervisor: {
        intent: verdict.intent,
        confidence: verdict.confidence,
        recommended: verdict.recommended,
        reason: verdict.reason,
        riskFlags: verdict.riskFlags,
        candidate: candidate.kind,
        rawJson: verdict.rawJson,
        replayMeta,
      },
    };
  }

  if (verdict.recommended === "silence") {
    await logDecision({
      ...logBase,
      decidedBy: "silent",
      action: "no_op",
      metadata: { ...replayMeta, rawJson: verdict.rawJson },
    });
    return { shouldRunLegacy: false };
  }

  if (verdict.recommended === "escalate_to_eli") {
    let draftId: number | null = null;
    try {
      draftId = await generateAndQueueDraft({
        manychatSubId: sid,
        moneyReason: "manual",
        pipelineStage: stage,
        leadName: freshLead?.name ?? null,
        botSummary: verdict.reason,
        triggerMessageId: inboundMessageId,
      });
    } catch (e) {
      console.error("[supervisor.dispatch] draft generation failed", e);
    }
    try {
      const who = freshLead?.name?.trim() || freshLead?.phone || sid;
      await sendEliDM(
        `🤖 Supervisor escalation — ${who} (${stage ?? "no stage"})\n` +
          `Inbound: "${inboundText.slice(0, 200)}"\n` +
          `LLM reason: ${verdict.reason}\n` +
          (draftId ? `Draft #${draftId} ready in /widget/drafts` : "Draft generation failed — reply manually from CRM.")
      );
    } catch (e) {
      console.error("[supervisor.dispatch] eli DM failed", e);
    }
    await logDecision({
      ...logBase,
      decidedBy: "code",
      action: draftId ? "draft_queued" : "escalated",
      escalationKind: "supervisor_decision",
      draftId,
      metadata: { ...replayMeta, rawJson: verdict.rawJson },
    });
    return { shouldRunLegacy: false };
  }

  if (verdict.recommended === "override_with_text") {
    if (!verdict.overrideText) {
      console.warn("[supervisor.dispatch] override_with_text with no text — falling back to approve_code");
    } else {
      try {
        await sendBridgeMessage(bridgeJid, verdict.overrideText);
      } catch (e) {
        console.error("[supervisor.dispatch] override send failed", e);
        await logDecision({
          ...logBase,
          decidedBy: "llm_override",
          action: "no_op",
          replyText: verdict.overrideText,
          metadata: { ...replayMeta, sendError: e instanceof Error ? e.message : String(e), rawJson: verdict.rawJson },
        });
        return { shouldRunLegacy: false };
      }
      await logDecision({
        ...logBase,
        decidedBy: "llm_override",
        action: "reply_sent",
        replyText: verdict.overrideText,
        metadata: { ...replayMeta, rawJson: verdict.rawJson, note: "override skipped existing handler — stage NOT transitioned" },
      });
      return { shouldRunLegacy: false };
    }
  }

  // approve_code — caller runs the legacy handler. We pass back the verdict
  // so the caller can include it in its own post-handler decision log.
  return {
    shouldRunLegacy: true,
    supervisor: {
      intent: verdict.intent,
      confidence: verdict.confidence,
      recommended: verdict.recommended,
      reason: verdict.reason,
      riskFlags: verdict.riskFlags,
      candidate: candidate.kind,
      rawJson: verdict.rawJson,
      replayMeta,
    },
  };
}

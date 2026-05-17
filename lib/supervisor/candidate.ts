/**
 * Candidate-action predictor — describes what the EXISTING deterministic
 * handler would likely do for a given inbound, without sending anything.
 *
 * Design choice (Phase 1): we don't dry-run the actual handler tree (too
 * coupled to side effects). Instead we run `classifyIntent` and map the
 * (stage, intent, decisionState) tuple to a coarse description. The
 * supervisor LLM uses this as one input among many — it doesn't need an
 * exact reply string, only a sense of "the bot was going to escalate" vs
 * "the bot had a canned answer ready."
 *
 * If supervisor.recommended = approve_code, the REAL handler runs after,
 * which makes its own (correct) routing decision. The candidate is advisory
 * context, not authoritative.
 */
import { classifyIntent, type Intent } from "../autoresponder/intent";

export type CandidateKind =
  | "questionnaire_step" // NEW stage — bot will advance the questionnaire
  | "quote_ready"        // NEW stage final step — bot will send quote
  | "canned_reply"       // matched intent has a canned reply ready
  | "sub_state_advance"  // intent triggers a sub-state prompt (e.g. "is the reason price?")
  | "escalate"           // bot will escalate to Eli (no reply or canned ack only)
  | "logo_received"      // AWAITING_LOGO + media inbound → factory routing
  | "logo_reask"         // AWAITING_LOGO + text only → re-ask up to 3x
  | "no_op"              // bot would do nothing (silent stages, unclassified, etc.)
  | "unknown";

export interface CandidateAction {
  kind: CandidateKind;
  intent: Intent | null;
  intentConfidence: number | null;
  intentSummary: string | null;
  /** Short human-readable description for the supervisor prompt. */
  description: string;
  /** When kind=canned_reply, an approximate label for the canned answer (no exact text — too brittle). */
  cannedReplyLabel?: string | null;
}

interface CandidateInput {
  stage: string | null;
  inboundText: string;
  hasMedia: boolean;
  qState: any;
  recentMessages?: { direction: "in" | "out"; text: string }[];
  leadName?: string | null;
}

export async function precomputeCandidateAction(
  input: CandidateInput
): Promise<CandidateAction> {
  const stage = (input.stage ?? "").toUpperCase();
  const decisionState: string | null = input.qState?.decisionState ?? null;
  const finalState: string | null = input.qState?.finalState ?? null;

  // Stage 1 — NEW. Bot will advance the questionnaire (no classifyIntent needed).
  if (!stage || stage === "NEW") {
    const step = input.qState?.step;
    const bailed = input.qState?.bailed === true;

    // BAILED: handler stopped the questionnaire after too many unmatched answers.
    // Any new inbound is post-bail — the deterministic handler will NOT respond.
    // Supervisor MUST escalate or override; never approve_code here.
    if (bailed) {
      return {
        kind: "no_op",
        intent: null,
        intentConfidence: null,
        intentSummary: null,
        description: `NEW stage but questionnaire BAILED (step=${step}, unmatchedAt=${input.qState?.unmatchedAt}). Handler will NOT respond — customer would be ghosted. Supervisor MUST escalate_to_eli or override_with_text.`,
      };
    }

    if (typeof step === "number" && step >= 1 && step <= 7) {
      return {
        kind: "questionnaire_step",
        intent: null,
        intentConfidence: null,
        intentSummary: null,
        description: `NEW stage, questionnaire mid-flow (step ${step}). Existing code will validate the inbound against the current step's options and advance.`,
      };
    }
    if (input.qState?.doneAt) {
      return {
        kind: "quote_ready",
        intent: null,
        intentConfidence: null,
        intentSummary: null,
        description: "NEW stage, questionnaire already completed. Existing code may regenerate a quote or no-op.",
      };
    }
    return {
      kind: "questionnaire_step",
      intent: null,
      intentConfidence: null,
      intentSummary: null,
      description: "NEW stage, questionnaire not started. Existing code will offer the first questionnaire step.",
    };
  }

  // AWAITING_LOGO — distinct from intent-based routing.
  if (stage === "AWAITING_LOGO") {
    if (input.hasMedia) {
      return {
        kind: "logo_received",
        intent: null,
        intentConfidence: null,
        intentSummary: null,
        description: "AWAITING_LOGO + media inbound. Existing code will set stage=WAITING_FACTORY, pause bot, DM Eli, ack the customer.",
      };
    }
    // text only — needs intent classification (to detect question_format vs re-ask)
    const ic = await classifySafe(input);
    if (ic.intent === "question_format") {
      return {
        kind: "canned_reply",
        intent: ic.intent,
        intentConfidence: ic.confidence,
        intentSummary: ic.summary ?? null,
        description: "AWAITING_LOGO, customer asking about logo file format. Existing code will send the canned format answer without consuming a re-ask attempt.",
        cannedReplyLabel: "logo_format",
      };
    }
    return {
      kind: "logo_reask",
      intent: ic.intent,
      intentConfidence: ic.confidence,
      intentSummary: ic.summary ?? null,
      description: "AWAITING_LOGO, no media. Existing code will re-ask for the logo (escalates after 3 attempts).",
    };
  }

  // Silent stages — bot does nothing today.
  if (
    stage === "WAITING_FACTORY" ||
    stage === "WON" ||
    stage === "DROPPED"
  ) {
    return {
      kind: "no_op",
      intent: null,
      intentConfidence: null,
      intentSummary: null,
      description: `Stage=${stage}. Existing code does NOTHING — customer would be ghosted until Eli notices.`,
    };
  }

  // AWAITING_ESTIMATE / AWAITING_FINAL — intent-routed.
  if (stage === "AWAITING_ESTIMATE" || stage === "AWAITING_FINAL") {
    // Sub-states short-circuit intent routing in the real handlers.
    if (stage === "AWAITING_ESTIMATE" && decisionState) {
      return {
        kind: "sub_state_advance",
        intent: null,
        intentConfidence: null,
        intentSummary: null,
        description: `AWAITING_ESTIMATE in sub-state "${decisionState}". Existing code will branch based on whether the inbound matches the expected sub-state response.`,
      };
    }
    if (stage === "AWAITING_FINAL" && finalState === "awaiting_haggle_detail") {
      return {
        kind: "escalate",
        intent: null,
        intentConfidence: null,
        intentSummary: null,
        description: `AWAITING_FINAL in sub-state "awaiting_haggle_detail". Existing code will ack + escalate (negotiating).`,
      };
    }

    const ic = await classifySafe(input);
    return mapStageIntent(stage, ic);
  }

  // Unknown stage — defensive.
  return {
    kind: "unknown",
    intent: null,
    intentConfidence: null,
    intentSummary: null,
    description: `Unrecognized stage="${stage}". Existing code will likely no-op.`,
  };
}

function mapStageIntent(
  stage: string,
  ic: { intent: Intent; confidence: number; summary?: string }
): CandidateAction {
  const base = {
    intent: ic.intent,
    intentConfidence: ic.confidence,
    intentSummary: ic.summary ?? null,
  };

  // Intents that always escalate post-quote
  const escalators: Intent[] = ["question_meeting"];
  if (escalators.includes(ic.intent)) {
    return {
      ...base,
      kind: "escalate",
      description: `${stage}, intent=${ic.intent}. Existing code will ack + escalate to Eli.`,
    };
  }

  // negotiating + reject — sub-state advance (ask follow-up question)
  if (ic.intent === "negotiating" || ic.intent === "reject") {
    return {
      ...base,
      kind: "sub_state_advance",
      description: `${stage}, intent=${ic.intent}. Existing code will set a sub-state and ask a clarifying question.`,
    };
  }

  // custom_size — sub-state for spec change (Stage 2) or escalate (Stage 4)
  if (ic.intent === "custom_size") {
    return {
      ...base,
      kind: stage === "AWAITING_ESTIMATE" ? "sub_state_advance" : "escalate",
      description: `${stage}, intent=custom_size. Existing code will ${
        stage === "AWAITING_ESTIMATE" ? "ask what to change (sub-state)" : "ack + escalate (Stage 4)"
      }.`,
    };
  }

  // accept — stage transition (or won)
  if (ic.intent === "accept") {
    return {
      ...base,
      kind: "canned_reply",
      description: `${stage}, intent=accept. Existing code will ${
        stage === "AWAITING_ESTIMATE" ? "transition to AWAITING_LOGO + ask for logo" : "set WON + DM Eli"
      }.`,
      cannedReplyLabel: stage === "AWAITING_ESTIMATE" ? "accept_to_logo" : "final_accept_won",
    };
  }

  // Canned-reply intents
  const cannedMap: Partial<Record<Intent, string>> = {
    samples_request: "samples",
    question_delivery: "delivery",
    question_inclusive: "inclusive",
    question_payment: stage === "AWAITING_ESTIMATE" ? "premature_payment_escalate" : "payment_50_50",
    question_format: "logo_format",
    question_company: "company_template",
  };
  if (cannedMap[ic.intent]) {
    const isPremature = ic.intent === "question_payment" && stage === "AWAITING_ESTIMATE";
    return {
      ...base,
      kind: isPremature ? "escalate" : "canned_reply",
      description: isPremature
        ? `AWAITING_ESTIMATE, premature payment question. Existing code will reply "I'll call" + escalate.`
        : `${stage}, intent=${ic.intent}. Existing code will send the canned ${cannedMap[ic.intent]} reply.`,
      cannedReplyLabel: cannedMap[ic.intent],
    };
  }

  // question_other / other — unmatch agent path (LLM fallback)
  return {
    ...base,
    kind: "escalate",
    description: `${stage}, intent=${ic.intent}. Existing code will route through the unmatch LLM agent; if no good answer found, escalate to Eli.`,
  };
}

async function classifySafe(
  input: CandidateInput
): Promise<{ intent: Intent; confidence: number; summary?: string }> {
  try {
    const result = await classifyIntent({
      inboundText: input.inboundText,
      recentMessages: input.recentMessages,
      leadName: input.leadName,
      pipelineStage: input.stage,
    });
    return result;
  } catch (e) {
    console.warn("[candidate] classifyIntent failed", e);
    return { intent: "other", confidence: 0 };
  }
}

import { createHash } from "node:crypto";
import {
  CALL_ANALYSIS_SCHEMA_VERSION,
  type CallActionType,
  type CallAnalysisV2,
  type CallNeed,
  type CallObjectionV2,
  type KnownBoolean,
  type ProposedCallAction,
  type RecommendedCallStatus,
} from "./analysis-v2";
import { normalizeTranscriptText, validateEvidence } from "./evidence";

type AnyRecord = Record<string, unknown>;

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "לא ידוע") return null;
  return trimmed;
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter((item): item is string => Boolean(item))
    : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intOrNull(value: unknown): number | null {
  const valueNumber = numberOrNull(value);
  return valueNumber == null ? null : Math.round(valueNumber);
}

function knownBoolean(value: unknown): KnownBoolean {
  return value === true || value === false ? value : null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function confidence(value: unknown): number {
  const numeric = numberOrNull(value) ?? 0;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function saneIsoDate(value: unknown, anchor: Date, maxFutureDays: number): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const earliest = anchor.getTime() - 2 * 24 * 60 * 60 * 1000;
  const latest = anchor.getTime() + maxFutureDays * 24 * 60 * 60 * 1000;
  if (parsed.getTime() < earliest || parsed.getTime() > latest) return null;
  return parsed.toISOString();
}

const ACTION_TYPES: readonly CallActionType[] = [
  "callback",
  "send_quote",
  "send_sample",
  "check_logo_received",
  "check_payment",
  "follow_up",
  "factory_check",
  "other",
];

const STATUSES: readonly RecommendedCallStatus[] = [
  "negotiation",
  "future_follow_up",
  "won",
  "lost",
  "no_change",
];

function normalizeProposedAction(
  value: unknown,
  transcript: string,
  anchor: Date,
  maxFutureDays: number,
): ProposedCallAction | null {
  const source = record(value);
  const description = text(source.description);
  if (!description) return null;
  return {
    actionType: enumValue(source.actionType, ACTION_TYPES, "other"),
    description,
    responsibleParty: enumValue(
      source.responsibleParty,
      ["salesperson", "customer", "factory", "unknown"] as const,
      "unknown",
    ),
    dueAt: saneIsoDate(source.dueAt, anchor, maxFutureDays),
    dueText: text(source.dueText),
    confidence: confidence(source.confidence),
    evidence: validateEvidence(record(source.evidence).quote ?? source.quote, transcript),
  };
}

export function analysisInputHash(transcript: string): string {
  return createHash("sha256").update(normalizeTranscriptText(transcript)).digest("hex");
}

export function normalizeCallAnalysisV2(
  raw: unknown,
  opts: {
    transcript: string;
    callStartedAt: Date;
    model?: string | null;
    guidanceRevision?: string;
    maxFutureDays?: number;
    minTranscriptChars?: number;
  },
): CallAnalysisV2 {
  const source = record(raw);
  const customer = record(source.customer);
  const specification = record(source.specification);
  const rep = record(source.salespersonExecution);
  const outcome = record(source.outcome);
  const transcript = opts.transcript ?? "";
  const maxFutureDays = opts.maxFutureDays ?? 60;
  const minTranscriptChars = opts.minTranscriptChars ?? 80;
  const legacyCallbackAt = saneIsoDate(source.callback_at, opts.callStartedAt, maxFutureDays);

  const needs: CallNeed[] = (Array.isArray(source.needs) ? source.needs : []).map((item) => {
    const value = record(item);
    return {
      need: text(value.need) ?? "לא ידוע",
      desiredOutcome: text(value.desiredOutcome),
      priority: enumValue(
        value.priority,
        ["appearance", "strength", "size", "price", "deadline", "other", "unknown"] as const,
        "unknown",
      ),
      evidence: validateEvidence(record(value.evidence).quote ?? value.quote, transcript),
    };
  });

  const objectionsV2: CallObjectionV2[] = (
    Array.isArray(source.objectionsV2) ? source.objectionsV2 : []
  ).map((item) => {
    const value = record(item);
    return {
      type: enumValue(
        value.type,
        ["price", "quantity", "delivery_time", "not_ready", "trust", "competitor", "other", "unknown"] as const,
        "unknown",
      ),
      customerWording: text(value.customerWording) ?? "לא ידוע",
      clarified: knownBoolean(value.clarified),
      handling: text(value.handling),
      resolution: enumValue(value.resolution, ["resolved", "open", "unclear"] as const, "unclear"),
      nextStep: text(value.nextStep),
      evidence: validateEvidence(record(value.evidence).quote ?? value.quote, transcript),
    };
  });

  const rawLegacyObjections = Array.isArray(source.objections) ? source.objections : [];
  const legacyObjections = rawLegacyObjections.map((item) => {
    const value = record(item);
    return { text: text(value.text) ?? "לא ידוע", ...(text(value.quote) ? { quote: text(value.quote)! } : {}) };
  });

  const proposedAction = normalizeProposedAction(
    outcome.proposedAction,
    transcript,
    opts.callStartedAt,
    maxFutureDays,
  );
  const rawRecommendation = record(outcome.statusRecommendation);
  const recommendationReason = text(rawRecommendation.reason);
  const statusRecommendation = recommendationReason
    ? {
        status: enumValue(rawRecommendation.status, STATUSES, "no_change"),
        reason: recommendationReason,
        confidence: confidence(rawRecommendation.confidence),
        evidence: validateEvidence(
          record(rawRecommendation.evidence).quote ?? rawRecommendation.quote,
          transcript,
        ),
      }
    : null;

  const callbackFromAction = proposedAction?.actionType === "callback" ? proposedAction.dueAt : null;
  const callbackReasonFromAction = proposedAction?.actionType === "callback"
    ? proposedAction.description
    : null;

  return {
    schema_version: CALL_ANALYSIS_SCHEMA_VERSION,
    metadata: {
      schemaVersion: CALL_ANALYSIS_SCHEMA_VERSION,
      model: opts.model ?? null,
      guidanceRevision: opts.guidanceRevision ?? "default-v2",
      inputHash: analysisInputHash(transcript),
      callStartedAt: opts.callStartedAt.toISOString(),
      timezone: "Asia/Jerusalem",
      transcriptLength: transcript.length,
    },
    call_summary: text(source.call_summary) ?? "",
    customer_needs: texts(source.customer_needs),
    objections: legacyObjections,
    price_discussion: text(source.price_discussion),
    competitor_mentions: texts(source.competitor_mentions),
    next_steps: texts(source.next_steps),
    sentiment: enumValue(source.sentiment, ["positive", "neutral", "negative"] as const, "neutral"),
    buying_signals: texts(source.buying_signals),
    follow_up_urgency: enumValue(source.follow_up_urgency, ["low", "medium", "high"] as const, "low"),
    red_flags: texts(source.red_flags),
    callback_at: callbackFromAction ?? legacyCallbackAt,
    callback_reason: callbackReasonFromAction ?? text(source.callback_reason),
    customer: {
      whyNow: text(customer.whyNow),
      business: text(customer.business),
      bagUse: text(customer.bagUse),
      existingBagProblem: text(customer.existingBagProblem),
      priorSupplierExperience: text(customer.priorSupplierExperience),
      requiredDate: text(customer.requiredDate),
    },
    needs,
    specification: {
      quantity: intOrNull(specification.quantity),
      size: text(specification.size),
      colors: intOrNull(specification.colors),
      details: texts(specification.details),
      approved: knownBoolean(specification.approved),
      missing: texts(specification.missing),
      logoExists: knownBoolean(specification.logoExists),
      logoSent: knownBoolean(specification.logoSent),
      pricePresented: knownBoolean(specification.pricePresented),
      fitsMinimumQuantity: knownBoolean(specification.fitsMinimumQuantity),
      decisionMaker: text(specification.decisionMaker),
      participants: texts(specification.participants),
    },
    salespersonExecution: {
      askedWhyNow: knownBoolean(rep.askedWhyNow),
      exploredSeveralNeeds: knownBoolean(rep.exploredSeveralNeeds),
      askedFollowUpBeforeSolution: knownBoolean(rep.askedFollowUpBeforeSolution),
      summarizedAndConfirmed: knownBoolean(rep.summarizedAndConfirmed),
      tailoredRecommendation: knownBoolean(rep.tailoredRecommendation),
      askedWhatBlocks: knownBoolean(rep.askedWhatBlocks),
      askedForPaymentWhenReady: knownBoolean(rep.askedForPaymentWhenReady),
      agreedActionOwnerDue: knownBoolean(rep.agreedActionOwnerDue),
      scoreOutOf10: Math.max(0, Math.min(10, numberOrNull(rep.scoreOutOf10) ?? 0)) || null,
      learningNotes: texts(rep.learningNotes),
    },
    objectionsV2,
    outcome: {
      result: text(outcome.result) ?? "לא ידוע",
      advance: text(outcome.advance),
      proposedAction,
      statusRecommendation,
    },
    isVoicemail: source.isVoicemail === true,
    isTooShortForAction:
      source.isTooShortForAction === true || normalizeTranscriptText(transcript).length < minTranscriptChars,
  };
}

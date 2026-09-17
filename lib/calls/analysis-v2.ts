export const CALL_ANALYSIS_SCHEMA_VERSION = "2.0" as const;

export type EvidenceValidation = "valid" | "missing" | "not_found";

export interface CallEvidence {
  quote: string | null;
  normalizedQuote: string | null;
  start: number | null;
  end: number | null;
  validation: EvidenceValidation;
}

export type KnownBoolean = true | false | null;

export interface CallNeed {
  need: string;
  desiredOutcome: string | null;
  priority: "appearance" | "strength" | "size" | "price" | "deadline" | "other" | "unknown";
  evidence: CallEvidence;
}

export interface CallObjectionV2 {
  type:
    | "price"
    | "quantity"
    | "delivery_time"
    | "not_ready"
    | "trust"
    | "competitor"
    | "other"
    | "unknown";
  customerWording: string;
  clarified: KnownBoolean;
  handling: string | null;
  resolution: "resolved" | "open" | "unclear";
  nextStep: string | null;
  evidence: CallEvidence;
}

export type CallActionType =
  | "callback"
  | "send_quote"
  | "send_sample"
  | "check_logo_received"
  | "check_payment"
  | "follow_up"
  | "factory_check"
  | "other";

export interface ProposedCallAction {
  actionType: CallActionType;
  description: string;
  responsibleParty: "salesperson" | "customer" | "factory" | "unknown";
  dueAt: string | null;
  dueText: string | null;
  confidence: number;
  evidence: CallEvidence;
}

export type RecommendedCallStatus =
  | "negotiation"
  | "future_follow_up"
  | "won"
  | "lost"
  | "no_change";

export interface CallStatusRecommendation {
  status: RecommendedCallStatus;
  reason: string;
  confidence: number;
  evidence: CallEvidence;
}

export interface CallAnalysisMetadata {
  schemaVersion: typeof CALL_ANALYSIS_SCHEMA_VERSION;
  model: string | null;
  guidanceRevision: string;
  inputHash: string;
  callStartedAt: string;
  timezone: "Asia/Jerusalem";
  transcriptLength: number;
}

/**
 * V2 intentionally keeps the V1 display fields at the top level. Existing
 * dossiers and note readers can continue to render saved analyses while the
 * operational policy reads only the grounded V2 fields below.
 */
export interface CallAnalysisV2 {
  schema_version: typeof CALL_ANALYSIS_SCHEMA_VERSION;
  metadata: CallAnalysisMetadata;

  call_summary: string;
  customer_needs: string[];
  objections: Array<{ text: string; quote?: string }>;
  price_discussion: string | null;
  competitor_mentions: string[];
  next_steps: string[];
  sentiment: "positive" | "neutral" | "negative";
  buying_signals: string[];
  follow_up_urgency: "low" | "medium" | "high";
  red_flags: string[];
  callback_at: string | null;
  callback_reason: string | null;

  customer: {
    whyNow: string | null;
    business: string | null;
    bagUse: string | null;
    existingBagProblem: string | null;
    priorSupplierExperience: string | null;
    requiredDate: string | null;
  };
  needs: CallNeed[];
  specification: {
    quantity: number | null;
    size: string | null;
    colors: number | null;
    details: string[];
    approved: KnownBoolean;
    missing: string[];
    logoExists: KnownBoolean;
    logoSent: KnownBoolean;
    pricePresented: KnownBoolean;
    fitsMinimumQuantity: KnownBoolean;
    decisionMaker: string | null;
    participants: string[];
  };
  salespersonExecution: {
    askedWhyNow: KnownBoolean;
    exploredSeveralNeeds: KnownBoolean;
    askedFollowUpBeforeSolution: KnownBoolean;
    summarizedAndConfirmed: KnownBoolean;
    tailoredRecommendation: KnownBoolean;
    askedWhatBlocks: KnownBoolean;
    askedForPaymentWhenReady: KnownBoolean;
    agreedActionOwnerDue: KnownBoolean;
    scoreOutOf10: number | null;
    learningNotes: string[];
  };
  objectionsV2: CallObjectionV2[];
  outcome: {
    result: string;
    advance: string | null;
    proposedAction: ProposedCallAction | null;
    statusRecommendation: CallStatusRecommendation | null;
  };
  isVoicemail: boolean;
  isTooShortForAction: boolean;
}

export function isCallAnalysisV2(value: unknown): value is CallAnalysisV2 {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { schema_version?: unknown }).schema_version === CALL_ANALYSIS_SCHEMA_VERSION,
  );
}

import type { LeadCardData } from "./LeadsBoard";

export type LifecycleKey =
  | "NEW_INQUIRY"
  | "QUALIFIED"
  | "SALES_ACCEPTED"
  | "OPPORTUNITY"
  | "CUSTOMER"
  | "CLOSED_LOST";

export type PriorityBand = "HOT" | "WARM" | "NURTURE" | "LOW";

export const LIFECYCLE_LABEL: Record<LifecycleKey, string> = {
  NEW_INQUIRY: "פנייה חדשה",
  QUALIFIED: "כשיר",
  SALES_ACCEPTED: "בטיפול מכירה",
  OPPORTUNITY: "הזדמנות",
  CUSTOMER: "לקוח",
  CLOSED_LOST: "נסגר שלילי",
};

export const PRIORITY_LABEL: Record<PriorityBand, string> = {
  HOT: "חם",
  WARM: "חמים",
  NURTURE: "לטיפוח",
  LOW: "נמוך",
};

export function quoteNumber(value: string | null): number {
  if (!value) return 0;
  const n = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function leadAgeHours(card: Pick<LeadCardData, "lastInboundAt" | "updatedAt">): number {
  const raw = card.lastInboundAt ?? card.updatedAt;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (Date.now() - time) / 36e5);
}

export function hasCallSignal(card: Pick<LeadCardData, "pipelineFlag" | "flags" | "botSummary" | "notes" | "lastInboundText">): boolean {
  const hay = [
    card.pipelineFlag,
    ...card.flags,
    card.botSummary,
    card.notes,
    card.lastInboundText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    hay.includes("call") ||
    hay.includes("requested_call") ||
    hay.includes("שיחה") ||
    hay.includes("טלפון")
  );
}

export function lifecycleOf(stage: string | null | undefined): LifecycleKey {
  switch ((stage ?? "NEW").toUpperCase()) {
    case "NEW":
      return "NEW_INQUIRY";
    case "AWAITING_ESTIMATE":
      return "QUALIFIED";
    case "AWAITING_LOGO":
    case "WAITING_FACTORY":
      return "SALES_ACCEPTED";
    case "AWAITING_FINAL":
      return "OPPORTUNITY";
    case "WON":
      return "CUSTOMER";
    case "DROPPED":
      return "CLOSED_LOST";
    default:
      return "NEW_INQUIRY";
  }
}

export function priorityOf(card: LeadCardData): PriorityBand {
  const quote = quoteNumber(card.quoteTotal);
  if (
    card.pipelineFlag === "NEEDS_ELI" ||
    card.botPaused ||
    hasCallSignal(card) ||
    quote >= 10000
  ) {
    return "HOT";
  }
  if (quote > 0 || ["WAITING_FACTORY", "AWAITING_FINAL"].includes((card.stage ?? "").toUpperCase())) {
    return "WARM";
  }
  if (leadAgeHours(card) >= 48 || card.followUpCount >= 2) {
    return "NURTURE";
  }
  return "LOW";
}

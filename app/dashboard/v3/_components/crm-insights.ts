import type { LeadCardData } from "./LeadsBoard";
import type { PriorityBand } from "@/lib/crm/insights";

export {
  LIFECYCLE_LABEL,
  PRIORITY_LABEL,
  lifecycleOf,
  type LifecycleKey,
  type PriorityBand,
} from "@/lib/crm/insights";

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
  if (quote > 0 || ["FACTORY_WAIT", "CONSIDERATION"].includes((card.stage ?? "").toUpperCase())) {
    return "WARM";
  }
  if (leadAgeHours(card) >= 48 || card.followUpCount >= 2) {
    return "NURTURE";
  }
  return "LOW";
}

/**
 * High-level bucket mapping for the v3 Leads board. The bot internally uses
 * 11 fine-grained pipeline stages (lib/manychat/stages.ts), but the UI groups
 * them into 4 supervisor-facing buckets:
 *
 *   NEEDS_ELI       — needs Eli to act (escalations + Eli-driven stages)
 *   BOT_ACTIVE      — bot in active conversation flow (cron will follow up)
 *   WAITING_CUSTOMER— bot replied, no nudge planned, waiting for customer
 *   CLOSED          — terminal stages (WON / DROPPED)
 *
 * The fine-grained stage is still shown as a chip on each card and is fully
 * editable from the drawer.
 */

export type BucketKey =
  | "NEEDS_ELI"
  | "BOT_ACTIVE"
  | "WAITING_CUSTOMER"
  | "CLOSED";

export const BUCKET_ORDER: BucketKey[] = [
  "NEEDS_ELI",
  "BOT_ACTIVE",
  "WAITING_CUSTOMER",
  "CLOSED",
];

export const BUCKET_LABEL: Record<BucketKey, string> = {
  NEEDS_ELI: "דורש אותך",
  BOT_ACTIVE: "בוט עובד",
  WAITING_CUSTOMER: "ציפיה ללקוח",
  CLOSED: "סגורים",
};

export const BUCKET_TONE: Record<
  BucketKey,
  { dot: string; pill: string; ring: string }
> = {
  NEEDS_ELI: {
    dot: "bg-rose-500",
    pill: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
    ring: "ring-rose-500/40",
  },
  BOT_ACTIVE: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
    ring: "ring-emerald-500/40",
  },
  WAITING_CUSTOMER: {
    dot: "bg-amber-500",
    pill: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
    ring: "ring-amber-500/40",
  },
  CLOSED: {
    dot: "bg-slate-500",
    pill: "bg-slate-500/15 text-slate-400 border border-slate-500/30",
    ring: "ring-slate-500/40",
  },
};

const ELI_STAGES = new Set(["WAITING_FACTORY", "IN_PROGRESS", "WAITING_CALL"]);
const ACTIVE_STAGES = new Set([
  "NEW",
  "AWAITING_DECISION",
  "AWAITING_LOGO",
  "AWAITING_FINAL",
]);
const WAITING_STAGES = new Set(["QUOTED", "NEGOTIATING"]);
const CLOSED_STAGES = new Set(["WON", "DROPPED"]);

export function bucketOf(lead: {
  stage: string | null | undefined;
  pipelineFlag: string | null | undefined;
  botPaused: boolean;
}): BucketKey {
  const stage = (lead.stage ?? "NEW").toUpperCase();
  if (CLOSED_STAGES.has(stage)) return "CLOSED";
  if (
    lead.pipelineFlag === "NEEDS_ELI" ||
    lead.botPaused ||
    ELI_STAGES.has(stage)
  ) {
    return "NEEDS_ELI";
  }
  if (WAITING_STAGES.has(stage)) return "WAITING_CUSTOMER";
  if (ACTIVE_STAGES.has(stage)) return "BOT_ACTIVE";
  // Unknown / unclassified — treat as bot-active so it surfaces for review.
  return "BOT_ACTIVE";
}

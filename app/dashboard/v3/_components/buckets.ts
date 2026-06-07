/**
 * High-level bucket mapping for the v3 Leads board. The bot uses 8 canonical
 * pipeline stages (lib/manychat/stages.ts → V2_PIPELINE_STAGES); the UI groups
 * them into 4 supervisor-facing buckets:
 *
 *   NEEDS_ELI       — escalations (NEEDS_ELI flag, bot_paused) or
 *                     FACTORY_WAIT (subFlow=awaiting_factory_estimate)
 *   BOT_ACTIVE      — bot driving (pre-quote / INTAKE /
 *                     FACTORY_WAIT awaiting_logo / CONSIDERATION)
 *   WAITING_CUSTOMER— passive wait (INTAKE / DISCAVERY /
 *                     CONSIDERATION)
 *   CLOSED          — terminal stages (WON / LOST)
 *
 * The stage chip on each card is still fully editable via StagePicker.
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

// Stages where bot is actively driving the conversation.
const ACTIVE_STAGES = new Set([
  "INTAKE",
  "CONSIDERATION",
]);
// Stages where we're passively waiting on the customer.
const WAITING_STAGES = new Set([
  "INTAKE",
  "DISCAVERY",
  "CONSIDERATION",
]);
const CLOSED_STAGES = new Set(["WON", "LOST"]);

export function bucketOf(lead: {
  stage: string | null | undefined;
  pipelineFlag: string | null | undefined;
  botPaused: boolean;
  qState?: { subFlow?: string | null } | null;
}): BucketKey {
  const stage = (lead.stage ?? "").toUpperCase();
  if (CLOSED_STAGES.has(stage)) return "CLOSED";

  const subFlow = lead.qState?.subFlow ?? null;
  // FACTORY_WAIT splits:
  //   subFlow=awaiting_factory_estimate → Eli/factory works price → NEEDS_ELI bucket
  //   subFlow=awaiting_logo (or unset)  → bot collecting logo → BOT_ACTIVE bucket
  if (stage === "FACTORY_WAIT") {
    if (subFlow === "awaiting_factory_estimate") return "NEEDS_ELI";
    if (lead.pipelineFlag === "NEEDS_ELI" || lead.botPaused) return "NEEDS_ELI";
    return "BOT_ACTIVE";
  }

  if (lead.pipelineFlag === "NEEDS_ELI" || lead.botPaused) {
    return "NEEDS_ELI";
  }
  if (WAITING_STAGES.has(stage)) return "WAITING_CUSTOMER";
  if (ACTIVE_STAGES.has(stage)) return "BOT_ACTIVE";
  // No stage (pre-quote questionnaire) — bot is actively driving.
  if (!stage) return "BOT_ACTIVE";
  // Unknown / unclassified — treat as bot-active so it surfaces for review.
  return "BOT_ACTIVE";
}

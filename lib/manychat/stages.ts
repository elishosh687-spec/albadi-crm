// Client-safe pipeline stage / flag constants.
// Do NOT import from `./config` here — config.ts evaluates `MANYCHAT_TOKEN`
// at module load and throws on the client. This file is safe to import
// from "use client" components.

// 6 canonical stages — funnel model aligned with the GHL kanban columns the
// operator sees in Opportunities. The four active stages compress what used
// to be a 6-stage journey:
//   INTAKE         = questionnaire running + auto-quote sent (pre-engagement)
//   DISCAVERY      = engaged, salesperson discovery call + commitment signal
//   FACTORY_WAIT   = factory check for non-standard specs
//   CONSIDERATION  = final quote sent, customer considering / negotiating
//   WON / LOST     = terminal
// Sub-states like "snooze for callback" or "waiting on logo" live as tasks
// (crm_tasks) or flags, not as their own stages. See docs/CUSTOMER-FLOW.md.
export const V2_PIPELINE_STAGES = [
  "INTAKE",
  "DISCAVERY",
  "FACTORY_WAIT",
  "CONSIDERATION",
  "WON",
  "LOST",
] as const;

export type V2PipelineStage = (typeof V2_PIPELINE_STAGES)[number];

export const V2_STAGE_LABELS: Record<V2PipelineStage, string> = {
  INTAKE: "שאלון + הצעה אוטומטית",
  DISCAVERY: "שיחת בירור",
  FACTORY_WAIT: "בדיקת מפעל",
  CONSIDERATION: "שוקל הצעה / מו״מ",
  WON: "נסגר",
  LOST: "לא נסגר",
};

// Legacy -> new mapping. Consumed by:
//   - DB backfill (UPDATE leads SET pipeline_stage = ... — see migration below)
//   - classifier prompt (so previous-decision history with old names still parses)
//   - runtime safety net in any code that may still read a legacy value
// `null` means "no stage" — pre-quote leads sit at pipeline_stage = NULL while
// the questionnaire is running and graduate to INTAKE after quote.
//
// The 2026-06-07 rename merged 6 journey stages into the new 4-stage funnel.
// Keep all pre-rename names here so a stale DB row, an old API payload, or a
// log entry still normalizes cleanly.
export const LEGACY_STAGE_MAP: Record<string, V2PipelineStage | null> = {
  NEW: null,
  // 2026-06-07 funnel rename
  INITIAL_QUOTE_SENT: "INTAKE",
  AWAITING_FIRST_RESPONSE: "INTAKE",
  SHOWED_INTEREST: "DISCAVERY",
  FACTORY_CHECK: "FACTORY_WAIT",
  FINAL_QUOTE_SENT: "CONSIDERATION",
  NEGOTIATING: "CONSIDERATION",
  // Older renames (pre-2026-06-07)
  AWAITING_ESTIMATE: "INTAKE",
  AWAITING_LOGO: "FACTORY_WAIT",
  WAITING_FACTORY: "FACTORY_WAIT",
  AWAITING_FINAL: "CONSIDERATION",
  CALLBACK_LATER: "DISCAVERY",
  DROPPED: "LOST",
  WON: "WON",
};

// Normalize any string (current or legacy) to a current stage.
// Returns null if input is unknown OR maps to "no stage" (pre-quote NEW).
export function normalizeStage(
  raw: string | null | undefined
): V2PipelineStage | null {
  if (!raw) return null;
  if ((V2_PIPELINE_STAGES as readonly string[]).includes(raw)) {
    return raw as V2PipelineStage;
  }
  if (raw in LEGACY_STAGE_MAP) {
    return LEGACY_STAGE_MAP[raw];
  }
  return null;
}

// Loss reasons — set on leads.loss_reason when stage = LOST.
export const LOSS_REASONS = [
  "יקר_לו",
  "לא_ענה",
  "לא_רלוונטי",
  "מצא_ספק_אחר",
  "זמן_אספקה",
  "כמות",
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  "יקר_לו": "יקר לו",
  "לא_ענה": "לא ענה",
  "לא_רלוונטי": "לא רלוונטי",
  "מצא_ספק_אחר": "מצא ספק אחר",
  "זמן_אספקה": "זמן אספקה לא מתאים",
  "כמות": "כמות לא מתאימה",
};

// Existing 5 flags — kept with numeric ManyChat IDs for backward compat with
// the legacy addTag(sid, tagId) signature in lib/bridge/client.ts. After
// bridge cutover these IDs are vestigial — tags are stored by NAME in
// lead_tags. Long-term cleanup: drop the numeric map entirely.
export const V2_FLAG_TAG_IDS = {
  "דחוף": 87265384,
  "עסקה_גדולה": 87265385,
  "ביקש_שיחה": 87265386,
  "אחרי_החג": 87265387,
  "מועדף": 87265390,
} as const;

// New flags added with stage refactor — name-only. Auto-set/cleared on stage
// transitions via the setLeadStage hook (see app/actions/v2.ts).
// NOTE: "לא_ענה" was removed — not used in flow, was breaking the build
// because actions/v2.ts:83 indexed V2_FLAG_TAG_IDS by name and "לא_ענה" had
// no numeric id. If/when re-added, also add an id to V2_FLAG_TAG_IDS or guard
// the index with flagHasNumericId.
export const V2_EXTRA_FLAG_NAMES = [
  "לקוח_חם",      // set when stage -> DISCAVERY
  "מחכה_למפעל",   // set when stage -> FACTORY_WAIT
] as const;

export type V2FlagName =
  | keyof typeof V2_FLAG_TAG_IDS
  | (typeof V2_EXTRA_FLAG_NAMES)[number];

export const V2_FLAG_NAMES: V2FlagName[] = [
  ...(Object.keys(V2_FLAG_TAG_IDS) as (keyof typeof V2_FLAG_TAG_IDS)[]),
  ...V2_EXTRA_FLAG_NAMES,
];

// True if the flag has a numeric ManyChat tag id (legacy path).
export function flagHasNumericId(name: V2FlagName): boolean {
  return name in V2_FLAG_TAG_IDS;
}

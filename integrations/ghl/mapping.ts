// Maps Albadi local lead state → GHL payloads.
//
// Two responsibilities:
//   1. Pick GHL Opportunity Stage ID from local pipeline_stage + pipeline_flag.
//   2. Build a minimal GHL custom-field array (5 fields). Calculator widget
//      reads the full q_state directly from the Albadi DB — GHL never holds
//      questionnaire data.

import { GHL_FIELD_IDS, GHL_STAGE_IDS, type LocalStage } from "./config";
import type { GHLCustomFieldValue } from "./client";

// Shape coming from the leads table — loose so callers don't have to
// import the full Drizzle row type.
export interface LocalLeadSnapshot {
  manychatSubId: string;
  name?: string | null;
  phoneE164?: string | null;
  waJid?: string | null;
  pipelineStage?: string | null;
  pipelineFlag?: string | null;
  botSummary?: string | null;
  quoteTotal?: string | null;
  lossReason?: string | null;
  botPaused?: boolean | null;
  followUpDate?: string | null;
  followUpCount?: number | null;
  nextAction?: string | null;
  leadScore?: string | null;
}

/**
 * Resolve the GHL stage id for a local lead.
 *
 * Priority:
 *   1. If pipeline_flag === 'NEEDS_ELI' and GHL_STAGE_NEEDS_ELI is set,
 *      escalate the opportunity to that stage regardless of pipeline_stage.
 *   2. Otherwise, look up pipeline_stage in GHL_STAGE_IDS.
 *   3. Fallback to NEW.
 *
 * Returns `null` if no stage id is configured (caller should skip update).
 */
export function pickStageId(lead: LocalLeadSnapshot): string | null {
  if (lead.pipelineFlag === "NEEDS_ELI" && GHL_STAGE_IDS.NEEDS_ELI) {
    return GHL_STAGE_IDS.NEEDS_ELI;
  }
  // pipeline_stage = NULL means pre-quote (questionnaire still running).
  // Map these leads to INTAKE so they appear in the GHL
  // pipeline kanban (operator decision 2026-06-07 — "want to see new leads
  // in pipeline too, not only contacts"). The Hebrew label "ממתין לתגובה
  // ראשונה" fits pre-questionnaire leads cleanly.
  //
  // Safety: when GHL's resync writes INTAKE back to DB
  // and the customer's next inbound arrives, the bot routing at
  // app/api/bridge/webhook/route.ts:823 short-circuits on
  // `questionnaireActive` BEFORE checking stage, so the questionnaire flow
  // continues uninterrupted. Once the questionnaire completes,
  // handleInbound promotes the stage to INTAKE (existing
  // behavior) and the lead moves to the next column.
  if (!lead.pipelineStage) {
    return GHL_STAGE_IDS.INTAKE || null;
  }
  const stage = lead.pipelineStage as LocalStage;
  return GHL_STAGE_IDS[stage] || null;
}

/**
 * Resolve GHL opportunity status (open/won/lost/abandoned) from local
 * pipeline_stage. GHL UI lets users see "won/lost" markers separate from
 * pipeline-stage display.
 */
export function pickOpportunityStatus(
  lead: LocalLeadSnapshot
): "open" | "won" | "lost" | "abandoned" {
  if (lead.pipelineStage === "WON") return "won";
  if (lead.pipelineStage === "LOST") return "lost";
  return "open";
}

// ----- Custom field mapping (minimal: 5 fields) -----

function add(
  out: GHLCustomFieldValue[],
  key: string,
  value: unknown
): void {
  const id = GHL_FIELD_IDS[key];
  if (!id) return; // field not configured in env — skip silently
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim() === "") return;
  out.push({ id, value: value as string | number | boolean });
}

/**
 * Build the customFields[] payload for a contact upsert OR an opportunity
 * update. Same shape works for both — GHL accepts {id, value}.
 *
 * Intentionally minimal: only what Eli needs to see / search inside the
 * GHL native UI without opening the embedded calculator. The calculator
 * iframe reads `leads.q_state`, `leads.quote_alt`, follow-up state, etc.
 * directly from the Albadi DB on its own.
 */
export function buildCustomFieldsPayload(
  lead: LocalLeadSnapshot
): GHLCustomFieldValue[] {
  const out: GHLCustomFieldValue[] = [];
  add(out, "manychat_sub_id", lead.manychatSubId);
  add(out, "wa_jid", lead.waJid);
  add(out, "bot_summary", lead.botSummary);
  add(out, "quote_total", lead.quoteTotal ? Number(lead.quoteTotal) : null);
  // `pipeline_flag` + `loss_reason` GHL custom fields removed 2026-06-08 (Eli
  // didn't use them). Source of truth stays in DB (`leads.pipeline_flag` drives
  // bot routing/tasks; `leads.loss_reason` still set via dashboard). We just
  // stop mirroring them to GHL. Do NOT re-add without re-creating the fields.
  // Legacy `bot_paused` RADIO removed 2026-05-23 — replaced by `lead_owner`
  // which carries the same information in a clearer form.
  add(out, "follow_up_date", lead.followUpDate);
  // Always push follow_up_count, even when 0 — empty cells in GHL look like
  // missing data; explicit 0 means "no follow-ups sent yet".
  if (lead.followUpCount !== undefined && lead.followUpCount !== null) {
    add(out, "follow_up_count", lead.followUpCount);
  } else {
    add(out, "follow_up_count", 0);
  }
  add(out, "next_action", lead.nextAction);
  // Next Action V2 — RADIO version (12 operational enum values). Same source
  // (leads.next_action) but pushed to the V2 GHL field so we get a typed
  // dropdown in the UI instead of free text.
  add(out, "next_action_v2", lead.nextAction);
  // Lead Score GHL custom field removed 2026-06-08 (unused by Eli). DB keeps
  // its own banding in `lead_score_snapshots`; we just stop mirroring to GHL.
  // Lead Owner — derived from bot_paused. Single source of truth. The widget
  // toggle writes bot_paused; we mirror to GHL so the contact card shows
  // who's currently driving the lead.
  if (lead.botPaused === true) {
    add(out, "lead_owner", "👨 Eli");
  } else if (lead.botPaused === false) {
    add(out, "lead_owner", "🤖 Bot");
  }
  return out;
}

/**
 * Build the public display name for the contact / opportunity.
 */
export function buildLeadDisplayName(lead: LocalLeadSnapshot): string {
  return (
    lead.name?.trim() ||
    lead.phoneE164?.trim() ||
    lead.manychatSubId.trim() ||
    "Lead"
  );
}

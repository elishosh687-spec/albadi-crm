/**
 * Deterministic next_action computation.
 *
 * Rules (in priority order):
 *   1. Override signals — pipeline_flag, drafts, factory state
 *   2. Stage-based defaults
 *
 * If a lead has bot_paused=true, the computed value is still returned
 * (callers can decide whether to write it). Manual overrides (Eli sets
 * value directly in GHL UI) take precedence — see the resync flow.
 */
import { db } from "@/lib/db";
import { leads, botDrafts, factoryQuoteRequests } from "@/drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

export type NextAction =
  | "wait_response"
  | "whatsapp"
  | "call"
  | "send_quote"
  | "negotiate"
  | "approve_draft"
  | "send_to_factory"
  | "follow_factory"
  | "schedule_callback"
  | "close_deal"
  | "mark_lost"
  | "no_action";

export async function computeNextAction(sid: string): Promise<NextAction | null> {
  const [lead] = await db
    .select({
      pipelineStage: leads.pipelineStage,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      followUpCount: leads.followUpCount,
      qState: leads.qState,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  if (!lead) return null;

  // ---- override signals (highest priority) ----

  // 1. Pending draft awaiting Eli approval → approve_draft
  const pendingDrafts = await db
    .select({ id: botDrafts.id })
    .from(botDrafts)
    .where(and(eq(botDrafts.manychatSubId, sid), eq(botDrafts.status, "pending")))
    .limit(1);
  if (pendingDrafts.length > 0) return "approve_draft";

  // 2. Pipeline flag = NEEDS_ELI → call (Eli must intervene)
  if (lead.pipelineFlag === "NEEDS_ELI") return "call";

  // 3. Factory request stuck — pending = waiting for Eli to send factory request
  //                          received = factory replied, awaiting Eli finalize
  const fqRow = await db
    .select({ status: factoryQuoteRequests.factoryStatus })
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.manychatSubId, sid))
    .orderBy(sql`${factoryQuoteRequests.updatedAt} DESC`)
    .limit(1);
  if (fqRow[0]) {
    if (fqRow[0].status === "pending") return "send_to_factory";
    if (fqRow[0].status === "received") return "close_deal"; // factory responded, finalize quote
  }

  // ---- stage-based defaults ----

  const stage = lead.pipelineStage;

  if (!stage) {
    // pre-quote: still in questionnaire
    return "wait_response";
  }

  switch (stage) {
    case "INITIAL_QUOTE_SENT":
    case "AWAITING_FIRST_RESPONSE":
      return "wait_response";
    case "SHOWED_INTEREST":
      return "whatsapp";
    case "FACTORY_CHECK":
      return "follow_factory";
    case "FINAL_QUOTE_SENT":
      return "wait_response";
    case "NEGOTIATING":
      return "negotiate";
    case "FUTURE_FOLLOWUP":
      return "schedule_callback";
    case "WON":
    case "LOST":
      return "no_action";
    default:
      return "wait_response";
  }
}

/**
 * Compute + persist next_action for a lead. Used by:
 *   - bot inbound flow (after each classification)
 *   - manual triggers (dashboard "recompute")
 *   - backfill scripts
 *
 * Skips the write if the existing DB value matches what we'd compute —
 * keeps updated_at clean.
 */
export async function refreshNextAction(sid: string): Promise<NextAction | null> {
  const computed = await computeNextAction(sid);
  if (computed === null) return null;
  const [current] = await db
    .select({ nextAction: leads.nextAction })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  if (current?.nextAction === computed) return computed;
  await db
    .update(leads)
    .set({ nextAction: computed, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`);
  return computed;
}

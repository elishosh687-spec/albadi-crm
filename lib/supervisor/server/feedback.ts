/**
 * Eli feedback on bot_decision_log rows. Shared by:
 *   - server actions in app/actions/v2.ts (dashboard)
 *   - /api/widget/decisions/:id/* routes (widget)
 */

import { db } from "@/lib/db";
import { botDecisionLog, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { syncLeadToGHL } from "@/integrations/ghl/sync";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/stages";

export interface FeedbackResult {
  ok: boolean;
  error?: string;
}

export async function confirmDecision(rowId: number): Promise<FeedbackResult> {
  if (!Number.isFinite(rowId) || rowId <= 0) {
    return { ok: false, error: "invalid row id" };
  }
  try {
    await db
      .update(botDecisionLog)
      .set({
        eliAction: "approved_as_is",
        eliCorrectionType: null,
        eliDecidedAt: new Date(),
      })
      .where(eq(botDecisionLog.id, rowId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save failed" };
  }
}

export async function correctDecisionIntent(
  rowId: number,
  correctIntent: string,
  note?: string
): Promise<FeedbackResult> {
  if (!Number.isFinite(rowId) || rowId <= 0) {
    return { ok: false, error: "invalid row id" };
  }
  const intent = (correctIntent ?? "").trim();
  if (!intent) return { ok: false, error: "missing intent" };
  try {
    await db
      .update(botDecisionLog)
      .set({
        eliIntentOverride: intent.slice(0, 100),
        eliCorrectionType: "routing",
        eliRejectReason: note?.trim() ? note.trim().slice(0, 1000) : null,
        eliDecidedAt: new Date(),
        eliAction: sql`COALESCE(${botDecisionLog.eliAction}, 'stage_override')`,
      })
      .where(eq(botDecisionLog.id, rowId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save failed" };
  }
}

export async function overrideDecisionStage(
  rowId: number,
  stage: string
): Promise<FeedbackResult> {
  if (!Number.isFinite(rowId) || rowId <= 0) {
    return { ok: false, error: "invalid row id" };
  }
  const cleanStage = stage.trim();
  if (!cleanStage) return { ok: false, error: "missing stage" };
  if (!(V2_PIPELINE_STAGES as readonly string[]).includes(cleanStage)) {
    return { ok: false, error: `invalid stage: ${cleanStage}` };
  }

  try {
    // Fetch the manychat_sub_id + prior stage from the decision row.
    const [row] = await db
      .select({ manychatSubId: botDecisionLog.manychatSubId })
      .from(botDecisionLog)
      .where(eq(botDecisionLog.id, rowId))
      .limit(1);

    if (!row) return { ok: false, error: "decision not found" };

    const [prior] = await db
      .select({ stage: leads.pipelineStage })
      .from(leads)
      .where(eq(leads.manychatSubId, row.manychatSubId))
      .limit(1);

    await db
      .update(leads)
      .set({ pipelineStage: cleanStage, updatedAt: new Date() })
      .where(eq(leads.manychatSubId, row.manychatSubId));

    await db
      .update(botDecisionLog)
      .set({
        eliStageFrom: prior?.stage ?? null,
        eliStageTo: cleanStage,
        eliAction: sql`COALESCE(${botDecisionLog.eliAction}, 'stage_override')`,
        eliDecidedAt: new Date(),
      })
      .where(eq(botDecisionLog.id, rowId));

    // Mirror to GHL so the pipeline view reflects the move. Fire-and-forget;
    // sync.ts swallows its own errors.
    void syncLeadToGHL(row.manychatSubId);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save failed" };
  }
}

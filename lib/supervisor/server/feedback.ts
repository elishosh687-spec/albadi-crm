/**
 * Eli feedback on bot_decision_log rows. Shared by:
 *   - server actions in app/actions/v2.ts (dashboard)
 *   - /api/widget/decisions/:id/* routes (widget)
 */

import { db } from "@/lib/db";
import { botDecisionLog, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";

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
  if (!stage.trim()) return { ok: false, error: "missing stage" };

  try {
    // Fetch the manychat_sub_id from the decision row so we can update the lead.
    const [row] = await db
      .select({ manychatSubId: botDecisionLog.manychatSubId })
      .from(botDecisionLog)
      .where(eq(botDecisionLog.id, rowId))
      .limit(1);

    if (!row) return { ok: false, error: "decision not found" };

    await db
      .update(leads)
      .set({ pipelineStage: stage })
      .where(eq(leads.manychatSubId, row.manychatSubId));

    await db
      .update(botDecisionLog)
      .set({
        eliStageTo: stage,
        eliAction: sql`COALESCE(${botDecisionLog.eliAction}, 'stage_override')`,
        eliDecidedAt: new Date(),
      })
      .where(eq(botDecisionLog.id, rowId));

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save failed" };
  }
}

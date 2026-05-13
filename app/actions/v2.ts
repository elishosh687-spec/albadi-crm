"use server";

import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// revalidatePath throws "static generation store missing" when called outside
// a Next.js request context (e.g. from tsx test scripts). Cache invalidation
// is best-effort — never let it break the action body.
function safeRevalidate(path: string, type: "layout" | "page" = "layout"): void {
  try {
    revalidatePath(path, type);
  } catch {
    /* outside Next request context — ignore */
  }
}
import {
  V2_FLAG_TAG_IDS,
  V2_PIPELINE_STAGES,
  type V2FlagName,
  type V2PipelineStage,
} from "@/lib/manychat/config";
import {
  addTag,
  getSubscriber,
  removeTag,
  setCustomFields,
} from "@/lib/messaging";
import { sendBridgeMessage } from "@/lib/bridge/client";

export interface SimpleResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function pushStageAndFlags(
  sid: string,
  stage: V2PipelineStage,
  flags: V2FlagName[]
): Promise<void> {
  const cleanSid = sid.trim();

  await setCustomFields(cleanSid, [
    { name: "pipeline_stage", value: stage },
  ]);

  const sub = await getSubscriber(cleanSid);
  const v2FlagTagIdValues = Object.values(V2_FLAG_TAG_IDS) as number[];
  const currentV2FlagTagIds: Set<number> = new Set(
    sub.tags.map((t) => t.id).filter((id) => v2FlagTagIdValues.includes(id))
  );

  const desiredFlagTagIds: Set<number> = new Set(
    flags
      .map((name) => V2_FLAG_TAG_IDS[name] as number)
      .filter((id): id is number => typeof id === "number")
  );

  for (const desired of desiredFlagTagIds) {
    if (!currentV2FlagTagIds.has(desired)) {
      try {
        await addTag(cleanSid, desired);
      } catch {
        /* swallow */
      }
    }
  }
  for (const current of currentV2FlagTagIds) {
    if (!desiredFlagTagIds.has(current)) {
      try {
        await removeTag(cleanSid, current);
      } catch {
        /* swallow */
      }
    }
  }
}

interface SetLeadStageInput {
  manychatSubId: string;
  stage: V2PipelineStage;
  flags: V2FlagName[];
  reason?: string;
}

export async function setLeadStage(
  input: SetLeadStageInput
): Promise<SimpleResult> {
  try {
    const cleanSid = input.manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    if (!V2_PIPELINE_STAGES.includes(input.stage)) {
      return { ok: false, error: `invalid stage: ${input.stage}` };
    }
    for (const f of input.flags) {
      if (!(f in V2_FLAG_TAG_IDS)) {
        return { ok: false, error: `invalid flag: ${f}` };
      }
    }

    try {
      await pushStageAndFlags(cleanSid, input.stage, input.flags);
    } catch (e) {
      safeRevalidate("/dashboard/v2", "layout");
      return {
        ok: false,
        error: `כתיבה נכשלה: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: `סטייג ${input.stage} נשמר` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

export async function updateLeadNotes(
  manychatSubId: string,
  notes: string
): Promise<SimpleResult> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    await setCustomFields(cleanSid, [{ name: "notes", value: notes }]);
    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: "ההערות נשמרו" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

/**
 * Stage 4 entry — Eli pushes the final price via dashboard, bot takes over
 * with stage=AWAITING_FINAL and the standard "מתאים?" classifier loop.
 * Per CUSTOMER-FLOW.md v2 §4 (decision: Eli updates stage manually).
 *
 * Side effects:
 *   - leads.pipelineStage = AWAITING_FINAL
 *   - leads.quoteTotal    = price (string)
 *   - leads.botPaused     = false (bot drives Stage 4)
 *   - leads.pipelineFlag  = null  (cleared — bot owns again)
 *   - leads.followUpCount = 0 (fresh cadence window 24/36/72h)
 *   - leads.lastFollowUpAt = now (anchor for next follow-up)
 *   - qState.decisionState / finalState = null (clean slate)
 *   - Sends WhatsApp message: "המחיר הסופי X. נשמח לשמוע את דעתכם על ההצעה."
 */
export async function sendFinalPrice(
  manychatSubId: string,
  price: string
): Promise<SimpleResult> {
  const cleanSid = manychatSubId.trim();
  if (!cleanSid) return { ok: false, error: "missing subscriberId" };
  const cleanPrice = price.trim();
  if (!cleanPrice) return { ok: false, error: "missing price" };

  try {
    const [row] = await db
      .select({
        sid: leads.manychatSubId,
        jid: leads.waJid,
        qState: leads.qState,
      })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
      .limit(1);
    if (!row) return { ok: false, error: "lead not found" };

    const recipient = row.jid ?? row.sid;
    const message =
      `המחיר הסופי הוא ${cleanPrice} ש"ח.\n\n` +
      `נשמח לשמוע את דעתכם על ההצעה.`;

    // Push WA first — if it fails we don't want to leave DB in the new state.
    await sendBridgeMessage(recipient, message);

    const cleared = {
      ...((row.qState as Record<string, unknown> | null) ?? {}),
      decisionState: null,
      finalState: null,
    };

    await db
      .update(leads)
      .set({
        pipelineStage: "AWAITING_FINAL",
        quoteTotal: cleanPrice,
        followUpCount: 0,
        lastFollowUpAt: new Date(),
        botPaused: false,
        pipelineFlag: null,
        botSummary: "Eli sent final price — awaiting customer decision",
        qState: cleared as any,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);

    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: `המחיר הסופי ${cleanPrice} נשלח` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "send failed",
    };
  }
}

// Toggle bot_paused on a lead. Setting paused=false also clears NEEDS_ELI
// and resets the follow-up counter (lead is back in the active loop).
export async function setBotPaused(
  manychatSubId: string,
  paused: boolean
): Promise<SimpleResult> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    if (paused) {
      await db
        .update(leads)
        .set({ botPaused: true, updatedAt: new Date() })
        .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);
    } else {
      await db
        .update(leads)
        .set({
          botPaused: false,
          pipelineFlag: null,
          followUpCount: 0,
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);
    }
    safeRevalidate("/dashboard/v2", "layout");
    return { ok: true, message: paused ? "הבוט מושהה" : "הבוט פעיל" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "toggle failed",
    };
  }
}

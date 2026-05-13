"use server";

import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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
      revalidatePath("/dashboard/v2", "layout");
      return {
        ok: false,
        error: `כתיבה נכשלה: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    revalidatePath("/dashboard/v2", "layout");
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
    revalidatePath("/dashboard/v2", "layout");
    return { ok: true, message: "ההערות נשמרו" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
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
    revalidatePath("/dashboard/v2", "layout");
    return { ok: true, message: paused ? "הבוט מושהה" : "הבוט פעיל" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "toggle failed",
    };
  }
}

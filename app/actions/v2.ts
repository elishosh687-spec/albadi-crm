"use server";

import { db } from "@/lib/db";
import { pipelineSuggestions, eliDecisions } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
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
} from "@/lib/manychat/client";

export interface SimpleResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function pushToManychat(
  sid: string,
  stage: V2PipelineStage,
  flags: V2FlagName[],
  nextAction: string | null,
  botSummary: string | null
): Promise<void> {
  const cleanSid = sid.trim();

  await setCustomFields(cleanSid, [
    { name: "pipeline_stage", value: stage },
    ...(nextAction !== null
      ? [{ name: "next_action" as const, value: nextAction }]
      : []),
    ...(botSummary !== null
      ? [{ name: "bot_summary" as const, value: botSummary }]
      : []),
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

interface ApproveInput {
  suggestionId: number;
  // Optional overrides — if absent, uses the suggested values
  stage?: V2PipelineStage;
  flags?: V2FlagName[];
  overrideReason?: string;
}

export async function approveSuggestion(
  input: ApproveInput
): Promise<SimpleResult> {
  try {
    const [sugg] = await db
      .select()
      .from(pipelineSuggestions)
      .where(eq(pipelineSuggestions.id, input.suggestionId))
      .limit(1);
    if (!sugg) return { ok: false, error: "suggestion not found" };
    if (sugg.status !== "pending_review") {
      return { ok: false, error: `already ${sugg.status}` };
    }

    const stage = (input.stage ?? sugg.suggestedStage) as V2PipelineStage;
    if (!V2_PIPELINE_STAGES.includes(stage)) {
      return { ok: false, error: `invalid stage: ${stage}` };
    }
    const flags = (input.flags ?? sugg.suggestedFlags ?? []) as V2FlagName[];

    const isOverride =
      stage !== sugg.suggestedStage ||
      JSON.stringify(flags.slice().sort()) !==
        JSON.stringify(((sugg.suggestedFlags ?? []) as string[]).slice().sort());

    await db
      .update(pipelineSuggestions)
      .set({
        status: isOverride ? "overridden" : "approved",
        approvedStage: stage,
        approvedFlags: flags,
        overrideReason: isOverride ? input.overrideReason ?? null : null,
        reviewedAt: new Date(),
      })
      .where(eq(pipelineSuggestions.id, input.suggestionId));

    await db.insert(eliDecisions).values({
      suggestionId: input.suggestionId,
      manychatSubId: sugg.manychatSubId,
      action: isOverride ? "overridden" : "approved",
      claudeSuggested: {
        stage: sugg.suggestedStage,
        flags: sugg.suggestedFlags,
        next_action: sugg.suggestedNextAction,
        bot_summary: sugg.suggestedSummary,
        reason: sugg.reason,
      },
      eliChose: { stage, flags },
      overrideReason: isOverride ? input.overrideReason ?? null : null,
    });

    try {
      await pushToManychat(
        sugg.manychatSubId,
        stage,
        flags,
        sugg.suggestedNextAction,
        sugg.suggestedSummary
      );
      await db
        .update(pipelineSuggestions)
        .set({ pushedToManychatAt: new Date() })
        .where(eq(pipelineSuggestions.id, input.suggestionId));
    } catch (e) {
      revalidatePath("/dashboard/v2");
      return {
        ok: false,
        error: `אישור נשמר ב-DB אך כתיבה ל-ManyChat נכשלה: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }

    revalidatePath("/dashboard/v2");
    return { ok: true, message: isOverride ? "Override נשמר" : "אושר" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "approve failed",
    };
  }
}

export async function rejectSuggestion(
  suggestionId: number,
  reason?: string
): Promise<SimpleResult> {
  try {
    const [sugg] = await db
      .select()
      .from(pipelineSuggestions)
      .where(eq(pipelineSuggestions.id, suggestionId))
      .limit(1);
    if (!sugg) return { ok: false, error: "suggestion not found" };
    if (sugg.status !== "pending_review") {
      return { ok: false, error: `already ${sugg.status}` };
    }

    await db
      .update(pipelineSuggestions)
      .set({
        status: "rejected",
        overrideReason: reason ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(pipelineSuggestions.id, suggestionId));

    await db.insert(eliDecisions).values({
      suggestionId,
      manychatSubId: sugg.manychatSubId,
      action: "rejected",
      claudeSuggested: {
        stage: sugg.suggestedStage,
        flags: sugg.suggestedFlags,
        next_action: sugg.suggestedNextAction,
        bot_summary: sugg.suggestedSummary,
        reason: sugg.reason,
      },
      eliChose: null,
      overrideReason: reason ?? null,
    });

    revalidatePath("/dashboard/v2");
    return { ok: true, message: "נדחה" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "reject failed",
    };
  }
}

export interface BulkResult {
  ok: boolean;
  approved: number;
  failed: number;
  errors?: string[];
}

export async function bulkApprove(
  suggestionIds: number[]
): Promise<BulkResult> {
  let approved = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const id of suggestionIds) {
    const res = await approveSuggestion({ suggestionId: id });
    if (res.ok) approved++;
    else {
      failed++;
      errors.push(`${id}: ${res.error}`);
    }
  }
  revalidatePath("/dashboard/v2");
  return { ok: failed === 0, approved, failed, errors: errors.length ? errors : undefined };
}

export async function updateLeadNotes(
  manychatSubId: string,
  notes: string
): Promise<SimpleResult> {
  try {
    const cleanSid = manychatSubId.trim();
    if (!cleanSid) return { ok: false, error: "missing subscriberId" };
    await setCustomFields(cleanSid, [{ name: "notes", value: notes }]);
    revalidatePath("/dashboard/v2");
    return { ok: true, message: "ההערות נשמרו" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "save failed",
    };
  }
}

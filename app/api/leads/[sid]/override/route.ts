/**
 * POST /api/leads/:id/override
 *
 * Manual override of a lead's pipeline state from the Retool console.
 * Mirrors the in-app server actions (setLeadStage / updateLeadNotes /
 * setBotPaused) but bundled into a single REST endpoint so Retool can call
 * it directly.
 *
 * Auth: Bearer BOT_SECRET.
 *
 * Body (all fields optional — patches only what is provided):
 *   {
 *     pipeline_stage?: V2PipelineStage,
 *     flags?: V2FlagName[],         // replaces full flag set on the lead
 *     notes?: string,
 *     bot_paused?: boolean,
 *     pipeline_flag?: string | null // e.g. 'NEEDS_ELI' or null to clear
 *   }
 *
 * NOTE: `:id` is the manychat_sub_id / wa_jid. We trim before matching to
 * tolerate the legacy trailing-space rows in the leads table.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, leadTags } from "@/drizzle/schema";
import { and, inArray, sql } from "drizzle-orm";
import {
  V2_FLAG_NAMES,
  V2_FLAG_TAG_IDS,
  V2_PIPELINE_STAGES,
  type V2FlagName,
  type V2PipelineStage,
} from "@/lib/manychat/stages";

export const runtime = "nodejs";
export const maxDuration = 10;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

interface OverrideBody {
  pipeline_stage?: string;
  flags?: string[];
  notes?: string;
  bot_paused?: boolean;
  pipeline_flag?: string | null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ sid: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { sid: rawSid } = await ctx.params;
  const sid = decodeURIComponent(rawSid).trim();
  if (!sid) {
    return NextResponse.json({ error: "missing sid" }, { status: 400 });
  }

  let body: OverrideBody = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const [existing] = await db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "lead not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const applied: string[] = [];

  if (body.pipeline_stage !== undefined) {
    if (!V2_PIPELINE_STAGES.includes(body.pipeline_stage as V2PipelineStage)) {
      return NextResponse.json(
        { error: `invalid pipeline_stage: ${body.pipeline_stage}` },
        { status: 400 }
      );
    }
    patch.pipelineStage = body.pipeline_stage;
    applied.push("pipeline_stage");
  }
  if (body.notes !== undefined) {
    patch.notes = body.notes;
    applied.push("notes");
  }
  if (body.bot_paused !== undefined) {
    patch.botPaused = Boolean(body.bot_paused);
    applied.push("bot_paused");
    // Mirror the existing server action: un-pausing clears NEEDS_ELI and
    // resets the follow-up counter (lead returns to the active loop).
    if (body.pipeline_flag === undefined && body.bot_paused === false) {
      patch.pipelineFlag = null;
      patch.followUpCount = 0;
    }
  }
  if (body.pipeline_flag !== undefined) {
    if (body.pipeline_flag === null || body.pipeline_flag === "") {
      patch.pipelineFlag = null;
    } else {
      patch.pipelineFlag = String(body.pipeline_flag);
    }
    applied.push("pipeline_flag");
  }

  // Apply flag set replacement separately (lead_tags table) when provided.
  let flagDiff: { added: string[]; removed: string[] } | null = null;
  if (body.flags !== undefined) {
    if (!Array.isArray(body.flags)) {
      return NextResponse.json({ error: "flags must be an array" }, { status: 400 });
    }
    const validNames = new Set<string>(V2_FLAG_NAMES);
    for (const f of body.flags) {
      if (typeof f !== "string" || !validNames.has(f)) {
        return NextResponse.json({ error: `invalid flag: ${f}` }, { status: 400 });
      }
    }
    const desired = new Set<V2FlagName>(body.flags as V2FlagName[]);

    const currentRows = await db
      .select({ tag: leadTags.tag })
      .from(leadTags)
      .where(sql`trim(${leadTags.manychatSubId}) = ${sid}`);
    const current = new Set<V2FlagName>(
      currentRows
        .map((r) => r.tag)
        .filter((t): t is V2FlagName => t in V2_FLAG_TAG_IDS)
    );

    const toAdd = [...desired].filter((f) => !current.has(f));
    const toRemove = [...current].filter((f) => !desired.has(f));

    for (const f of toAdd) {
      try {
        await db.insert(leadTags).values({ manychatSubId: sid, tag: f });
      } catch {
        /* race vs concurrent write — swallow */
      }
    }
    if (toRemove.length > 0) {
      await db
        .delete(leadTags)
        .where(
          and(
            sql`trim(${leadTags.manychatSubId}) = ${sid}`,
            inArray(leadTags.tag, toRemove)
          )
        );
    }
    flagDiff = { added: toAdd, removed: toRemove };
    applied.push("flags");
  }

  if (Object.keys(patch).length > 1) {
    await db
      .update(leads)
      .set(patch as any)
      .where(sql`trim(${leads.manychatSubId}) = ${sid}`);
  }

  return NextResponse.json({ ok: true, applied, flag_diff: flagDiff });
}

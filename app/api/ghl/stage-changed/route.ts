/**
 * GHL → albadi DB: opportunity stage change.
 *
 * Eli moves an opportunity between stages in the GHL UI. A GHL Workflow with
 * trigger "Opportunity Stage Changed" POSTs here with the contact + stage
 * ids. We reverse-map the GHL stage UUID to our local pipeline_stage enum
 * and update the lead row.
 *
 * GHL is the source of truth for pipeline state. The DB→GHL push in
 * integrations/ghl/sync.ts is still allowed for bot-originated classification
 * (LLM decisions in the cron). Loop prevention: when this webhook updates a
 * lead, we set updated_at to mark the change as GHL-origin; the bot's
 * syncLeadToGHL push happens after its own DB write, so the loop is bounded
 * by stage equality — sync.ts skips the GHL PUT when the resolved stage id
 * already matches what GHL reports.
 *
 * GHL Workflow setup:
 *   Trigger:  Opportunity Stage Changed (filter by Pipeline = Albadi)
 *   Action:   Webhook POST
 *     URL:    https://albadi-crm.vercel.app/api/ghl/stage-changed
 *     Header: Authorization: Bearer <BOT_SECRET>
 *             Content-Type: application/json
 *     Body (Custom Data):
 *       contactId      = {{contact.id}}
 *       opportunityId  = {{opportunity.id}}
 *       stageId        = {{opportunity.pipline_stage_id}}
 *
 * Auth: shared BOT_SECRET bearer (same as the rest of our internal API).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq, or, sql } from "drizzle-orm";
import { GHL_STAGE_IDS } from "@/integrations/ghl/config";

export const runtime = "nodejs";
export const maxDuration = 15;

interface Payload {
  contactId?: string;
  opportunityId?: string;
  stageId?: string;
}

function reverseLookupStage(stageId: string): string | null {
  for (const [localStage, ghlId] of Object.entries(GHL_STAGE_IDS)) {
    if (ghlId && ghlId === stageId) return localStage;
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.BOT_SECRET || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const { contactId, opportunityId, stageId } = payload;
  if (!stageId || (!contactId && !opportunityId)) {
    return NextResponse.json(
      { error: "missing_fields", need: "stageId + (contactId|opportunityId)" },
      { status: 400 }
    );
  }

  const localStage = reverseLookupStage(stageId);
  if (!localStage) {
    console.warn("[ghl.stage-changed] unknown stage id", { stageId });
    return NextResponse.json(
      { error: "unknown_stage_id", stageId },
      { status: 422 }
    );
  }

  const matchClause = contactId && opportunityId
    ? or(eq(leads.ghlContactId, contactId), eq(leads.ghlOpportunityId, opportunityId))
    : contactId
    ? eq(leads.ghlContactId, contactId)
    : eq(leads.ghlOpportunityId, opportunityId!);

  // NEEDS_ELI is a virtual stage (pipeline_flag, not pipeline_stage).
  // Treat it as a flag set + leave pipeline_stage alone.
  if (localStage === "NEEDS_ELI") {
    const result = await db
      .update(leads)
      .set({ pipelineFlag: "NEEDS_ELI", updatedAt: new Date() })
      .where(matchClause)
      .returning({ sid: leads.manychatSubId });
    if (result.length === 0) {
      return NextResponse.json(
        { error: "no_lead_matched", contactId, opportunityId },
        { status: 404 }
      );
    }
    console.log("[ghl.stage-changed] set NEEDS_ELI flag", {
      sid: result[0].sid,
    });
    return NextResponse.json({
      ok: true,
      sid: result[0].sid,
      action: "set_needs_eli_flag",
    });
  }

  const result = await db
    .update(leads)
    .set({
      pipelineStage: localStage,
      // Clear NEEDS_ELI flag when Eli explicitly moves the lead to a real
      // stage — it means he's handled the escalation.
      pipelineFlag: null,
      updatedAt: new Date(),
    })
    .where(matchClause)
    .returning({ sid: leads.manychatSubId });

  if (result.length === 0) {
    console.warn("[ghl.stage-changed] no lead matched", {
      contactId,
      opportunityId,
    });
    return NextResponse.json(
      { error: "no_lead_matched", contactId, opportunityId },
      { status: 404 }
    );
  }

  console.log("[ghl.stage-changed] updated", {
    sid: result[0].sid,
    pipelineStage: localStage,
  });
  return NextResponse.json({
    ok: true,
    sid: result[0].sid,
    pipelineStage: localStage,
  });
}

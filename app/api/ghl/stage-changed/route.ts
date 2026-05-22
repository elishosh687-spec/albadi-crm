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
import { GHL_STAGE_IDS, GHL_PIPELINE_ID } from "@/integrations/ghl/config";
import { findOpportunityForContact, getOpportunity } from "@/integrations/ghl/client";

export const runtime = "nodejs";
export const maxDuration = 15;

interface Payload {
  // GHL Workflow Custom Data — we tolerate several key names because the
  // exact variable token in GHL has changed across releases.
  contactId?: string;
  contact_id?: string;
  opportunityId?: string;
  opportunity_id?: string;
  stageId?: string;
  stage_id?: string;
  pipelineStageId?: string;
  pipeline_stage_id?: string;
  pipline_stage_id?: string; // GHL's own typo, kept for compat
  stageName?: string;
  stage_name?: string;
  [key: string]: unknown;
}

function pickStageId(p: Payload): string | null {
  return (
    p.stageId ||
    p.stage_id ||
    p.pipelineStageId ||
    p.pipeline_stage_id ||
    p.pipline_stage_id ||
    null
  );
}

function pickStageName(p: Payload): string | null {
  return p.stageName || p.stage_name || null;
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

  const rawBody = await req.text();
  console.log("[ghl.stage-changed] raw body", rawBody.slice(0, 800));

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody) as Payload;
  } catch {
    return NextResponse.json({ error: "bad_json", rawBody: rawBody.slice(0, 200) }, { status: 400 });
  }

  // Accept both camelCase (our Custom Data convention) and snake_case (GHL
  // Standard Data auto-attached on every workflow webhook).
  const contactId = payload.contactId || payload.contact_id;
  let opportunityId = payload.opportunityId || payload.opportunity_id;
  let stageId = pickStageId(payload);
  const stageName = pickStageName(payload);

  console.log("[ghl.stage-changed] parsed", {
    contactId,
    opportunityId,
    stageId,
    stageName,
    keys: Object.keys(payload),
  });

  if (!contactId && !opportunityId) {
    return NextResponse.json(
      {
        error: "missing_fields",
        need: "contactId or opportunityId",
        received: Object.keys(payload),
      },
      { status: 400 }
    );
  }

  // Fallback: if Custom Data didn't carry stageId, fetch it from GHL API.
  // GHL Workflow webhooks reliably send contact_id/opportunity_id in
  // Standard Data, but the Custom Data tokens for stage are flaky across
  // releases. Pulling the opportunity directly from GHL is more robust.
  if (!stageId) {
    try {
      if (opportunityId) {
        const opp = await getOpportunity(opportunityId);
        stageId = opp.pipelineStageId;
        console.log("[ghl.stage-changed] fetched stageId via getOpportunity", { stageId });
      } else if (contactId && GHL_PIPELINE_ID) {
        const opp = await findOpportunityForContact(contactId, GHL_PIPELINE_ID);
        if (opp) {
          stageId = opp.pipelineStageId;
          opportunityId = opp.id;
          console.log("[ghl.stage-changed] fetched via findOpportunityForContact", {
            stageId,
            opportunityId,
          });
        }
      }
    } catch (e) {
      console.warn("[ghl.stage-changed] GHL API lookup failed", e);
    }
  }

  if (!stageId) {
    return NextResponse.json(
      { error: "stage_lookup_failed", contactId, opportunityId },
      { status: 422 }
    );
  }

  const localStage = reverseLookupStage(stageId);
  if (!localStage) {
    console.warn("[ghl.stage-changed] unknown stage id", { stageId, stageName });
    return NextResponse.json(
      { error: "unknown_stage_id", stageId, stageName },
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
    // Eli set NEEDS_ELI ⇒ owner tag flips + escalation task surfaces.
    try {
      const { reconcileGHLTasksForLead } = await import(
        "@/lib/ghl-tasks/reconcile"
      );
      void reconcileGHLTasksForLead(result[0].sid);
    } catch (e) {
      console.warn("[ghl.stage-changed] ghl tasks reconcile failed", e);
    }
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
  // Re-evaluate signal-derived tasks (e.g. big_quote_close at FINAL_QUOTE_SENT,
  // idle_active_lead set cleared when moving to WON/LOST) + flip owner tag.
  try {
    const { reconcileGHLTasksForLead } = await import(
      "@/lib/ghl-tasks/reconcile"
    );
    void reconcileGHLTasksForLead(result[0].sid);
  } catch (e) {
    console.warn("[ghl.stage-changed] ghl tasks reconcile failed", e);
  }
  return NextResponse.json({
    ok: true,
    sid: result[0].sid,
    pipelineStage: localStage,
  });
}

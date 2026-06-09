/**
 * POST /api/admin/sync-lead
 *
 * Force a single lead through syncLeadToGHL. Useful for repairing leads
 * whose ghl_opportunity_id is null because the webhook path missed them
 * (typical cause: FB Lead Form path didn't trigger the sync).
 *
 * Auth: Bearer BOT_SECRET or CALL_TRIGGER_SECRET.
 *
 * Body: { "sid": "972525171818@s.whatsapp.net" }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { syncLeadToGHL } from "@/integrations/ghl/sync";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const accepted = [process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  const header = req.headers.get("authorization") ?? "";
  return accepted.some((s) => header === `Bearer ${s}`);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { sid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const sid = body.sid?.trim();
  if (!sid) {
    return NextResponse.json({ error: "missing_sid" }, { status: 400 });
  }

  const before = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      stage: leads.pipelineStage,
      ghlContactId: leads.ghlContactId,
      ghlOpportunityId: leads.ghlOpportunityId,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);
  if (!before[0]) {
    return NextResponse.json({ error: "lead_not_found", sid }, { status: 404 });
  }

  try {
    await syncLeadToGHL(sid);
  } catch (err) {
    return NextResponse.json(
      { error: "sync_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const after = await db
    .select({
      ghlContactId: leads.ghlContactId,
      ghlOpportunityId: leads.ghlOpportunityId,
      pipelineStage: leads.pipelineStage,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);

  return NextResponse.json({
    sid,
    name: before[0].name,
    before: {
      stage: before[0].stage,
      ghlContactId: before[0].ghlContactId,
      ghlOpportunityId: before[0].ghlOpportunityId,
    },
    after: after[0],
  });
}

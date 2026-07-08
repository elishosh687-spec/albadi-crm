/**
 * GET  /api/widget/pipeline-audit — returns the two audit lists (leads with no
 *      open task, leads whose pipeline_stage lags behind DB signals).
 * POST /api/widget/pipeline-audit — apply one suggestion: { sid, targetStage }.
 *      Moves the lead via setLeadStage. No bulk apply — Eli reviews each row.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { runPipelineAudit } from "@/lib/analysis/pipeline-audit";
import { V2_ASSIGNABLE_STAGES, type V2AssignableStage } from "@/lib/manychat/stages";
// setLeadStage is imported lazily inside POST — its transitive imports
// (lib/manychat/config) throw at module-eval when MANYCHAT_TOKEN is missing,
// which breaks GET even for reads that don't need it. See CLAUDE.md
// "Client-bundle import rule" for the same footgun.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function auth(req: NextRequest): boolean {
  const token =
    req.nextUrl.searchParams.get("widget_token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;
  return verifyWidgetToken(token);
}

export async function GET(req: NextRequest) {
  if (!auth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const audit = await runPipelineAudit();
    return NextResponse.json({ ok: true, ...audit });
  } catch (e) {
    console.error("[widget/pipeline-audit] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "audit failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!auth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { sid?: string; targetStage?: string; action?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  const sid = body.sid?.trim();

  // action="create_task": create a "call the customer" task for Itay, due today,
  // and push it to GHL. Used by the "נפלו בין הכיסאות" per-lead button — a lead
  // fell through the cracks (no auto-task / rep forgot the follow-up), so give
  // the salesperson a concrete task to talk to the customer.
  if (body.action === "create_task") {
    if (!sid) {
      return NextResponse.json({ ok: false, error: "missing sid" }, { status: 400 });
    }
    try {
      const { db } = await import("@/lib/db");
      const { crmTasks } = await import("@/drizzle/schema");
      const { GHL_SALESPERSON_USER_ID } = await import("@/integrations/ghl/config");
      const [inserted] = await db
        .insert(crmTasks)
        .values({
          manychatSubId: sid,
          title: "לדבר עם הלקוח",
          taskType: "follow_up",
          dueAt: new Date(), // today
          assignedTo: GHL_SALESPERSON_USER_ID || null,
        })
        .returning({ id: crmTasks.id });
      // Push to GHL — no-ops gracefully if the lead has no ghl_contact_id yet.
      try {
        const { syncTaskToGHL } = await import("@/integrations/ghl/sync");
        await syncTaskToGHL(inserted.id);
      } catch (err) {
        console.warn("[pipeline-audit] syncTaskToGHL failed (task saved in DB)", err);
      }
      return NextResponse.json({ ok: true, taskId: inserted.id });
    } catch (e) {
      console.error("[pipeline-audit] create_task failed", e);
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "task failed" },
        { status: 500 }
      );
    }
  }

  const targetStage = body.targetStage?.trim();
  if (!sid || !targetStage) {
    return NextResponse.json(
      { ok: false, error: "missing sid or targetStage" },
      { status: 400 }
    );
  }
  if (!(V2_ASSIGNABLE_STAGES as readonly string[]).includes(targetStage)) {
    return NextResponse.json(
      { ok: false, error: `invalid stage: ${targetStage}` },
      { status: 400 }
    );
  }
  const { setLeadStage } = await import("@/app/actions/v2");
  const result = await setLeadStage({
    manychatSubId: sid,
    stage: targetStage as V2AssignableStage,
    flags: [],
    reason: "pipeline_audit",
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

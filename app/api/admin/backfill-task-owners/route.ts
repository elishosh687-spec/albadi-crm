/**
 * One-shot backfill — every open crm_tasks row that landed without an owner
 * gets Itay (GHL_SALESPERSON_USER_ID). Also (re-)pushes the task to GHL so
 * it lands on Itay's board there.
 *
 * Auth: Bearer BOT_SECRET.
 * Returns: {ok, listed, updated, ghlPushed, unassigned:[{sid, name, title, ghlTaskId}]}
 * Idempotent — safe to re-run.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmTasks, leads } from "@/drizzle/schema";
import { GHL_SALESPERSON_USER_ID } from "@/integrations/ghl/config";
import { updateContactTask } from "@/integrations/ghl/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${process.env.BOT_SECRET}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!GHL_SALESPERSON_USER_ID) {
    return NextResponse.json(
      { ok: false, error: "GHL_SALESPERSON_USER_ID not configured" },
      { status: 500 }
    );
  }

  // Find every open task with no assigned owner (NULL or empty string).
  const rows = await db
    .select({
      id: crmTasks.id,
      sid: crmTasks.manychatSubId,
      title: crmTasks.title,
      dueAt: crmTasks.dueAt,
      status: crmTasks.status,
      ghlTaskId: crmTasks.ghlTaskId,
      name: leads.name,
      ghlContactId: leads.ghlContactId,
    })
    .from(crmTasks)
    .leftJoin(leads, eq(leads.manychatSubId, crmTasks.manychatSubId))
    .where(
      and(
        isNull(crmTasks.completedAt),
        or(isNull(crmTasks.assignedTo), eq(crmTasks.assignedTo, sql`''`))
      )
    );

  const unassigned = rows.map((r) => ({
    id: r.id,
    sid: r.sid,
    name: r.name,
    title: r.title,
    ghlTaskId: r.ghlTaskId,
    hasGhl: !!(r.ghlTaskId && r.ghlContactId),
  }));

  // Update DB — every row gets Itay as owner.
  let updated = 0;
  if (rows.length) {
    await db
      .update(crmTasks)
      .set({ assignedTo: GHL_SALESPERSON_USER_ID, updatedAt: new Date() })
      .where(
        and(
          isNull(crmTasks.completedAt),
          or(isNull(crmTasks.assignedTo), eq(crmTasks.assignedTo, sql`''`))
        )
      );
    updated = rows.length;
  }

  // Push to GHL — for tasks that already exist in GHL, patch the assignee.
  let ghlPushed = 0;
  const ghlErrors: { id: number; error: string }[] = [];
  for (const r of rows) {
    if (!r.ghlTaskId || !r.ghlContactId) continue;
    try {
      const dueIso = (r.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000))
        .toISOString();
      await updateContactTask(r.ghlContactId, r.ghlTaskId, {
        title: r.title,
        dueDate: dueIso,
        completed: r.status === "completed",
        assignedTo: GHL_SALESPERSON_USER_ID,
      });
      ghlPushed++;
    } catch (e) {
      ghlErrors.push({
        id: r.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    listed: rows.length,
    updated,
    ghlPushed,
    ghlErrors,
    unassigned,
  });
}

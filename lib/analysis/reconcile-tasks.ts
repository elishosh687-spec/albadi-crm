/**
 * GHL → DB task-completion reconcile. crm_tasks mirror GHL Contact Tasks, but
 * when Itay COMPLETES a task in GHL the completion doesn't always flow back to
 * the DB (no reliable task webhook). So a lead whose tasks are all done in GHL
 * still shows an OPEN crm_task in the DB — and the "נפלו בין הכיסאות" audit
 * (DB-based: NOT EXISTS open crm_task) wrongly treats it as handled.
 *
 * This closes any DB-open task whose GHL twin is completed (or gone), scoped to
 * ACTIVE leads that currently look handled — the only ones the audit could be
 * wrongly excluding. Best-effort per contact: a GHL failure just skips it.
 */
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, crmTasks } from "@/drizzle/schema";
import { listContactTasks } from "@/integrations/ghl/client";

const ACTIVE = ["INTAKE", "DISCAVERY", "FACTORY_WAIT", "CONSIDERATION"];
const CONCURRENCY = 6;

export interface TaskReconcileResult {
  ok: boolean;
  contactsChecked: number;
  tasksClosed: number;
}

export async function reconcileTasksFromGhl(): Promise<TaskReconcileResult> {
  // Active leads (NULL + the 4 active stages) that have a ghl_contact_id AND at
  // least one OPEN db task — i.e. the ones the audit currently thinks are
  // handled and would exclude. Anything with zero open tasks already surfaces.
  const rows = await db
    .select({ sid: leads.manychatSubId, ghl: leads.ghlContactId })
    .from(leads)
    .where(
      and(
        eq(leads.active, true),
        isNotNull(leads.ghlContactId),
        or(isNull(leads.pipelineStage), inArray(leads.pipelineStage, ACTIVE)),
        sql`EXISTS (
          SELECT 1 FROM ${crmTasks}
          WHERE ${crmTasks.manychatSubId} = ${leads.manychatSubId}
            AND ${crmTasks.completedAt} IS NULL
            AND ${crmTasks.status} <> 'completed'
        )`
      )
    );
  if (rows.length === 0) return { ok: true, contactsChecked: 0, tasksClosed: 0 };

  let tasksClosed = 0;
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      if (!r.ghl) continue;
      let ghlTasks;
      try {
        ghlTasks = await listContactTasks(r.ghl);
      } catch {
        continue; // best-effort — skip this contact on any GHL error
      }
      const completedIds = new Set(ghlTasks.filter((t) => t.completed).map((t) => t.id));
      const liveIds = new Set(ghlTasks.map((t) => t.id));
      const dbOpen = await db
        .select({ id: crmTasks.id, ghlId: crmTasks.ghlTaskId })
        .from(crmTasks)
        .where(
          and(
            eq(crmTasks.manychatSubId, r.sid),
            isNull(crmTasks.completedAt),
            ne(crmTasks.status, "completed")
          )
        );
      for (const t of dbOpen) {
        if (!t.ghlId) continue; // no GHL twin → can't verify, leave it open
        // Close when GHL shows it completed, or (only if we got a real task
        // list back) when it's absent entirely = deleted in GHL.
        const goneOrDone =
          completedIds.has(t.ghlId) || (ghlTasks.length > 0 && !liveIds.has(t.ghlId));
        if (goneOrDone) {
          await db
            .update(crmTasks)
            .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
            .where(eq(crmTasks.id, t.id));
          tasksClosed++;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return { ok: true, contactsChecked: rows.length, tasksClosed };
}

/**
 * Auto-task on stage entry — the "לפולואפ אחרי הצעה ראשונית" nudge that used
 * to only fire when Eli manually moved a lead via setLeadStage.
 *
 * Bug we're fixing: when a new lead's stage is written DIRECTLY on the leads
 * row (questionnaire completion → INTAKE, configurator submit → INTAKE),
 * the setLeadStage path is skipped and no task ever gets created. Result:
 * the pipeline-audit's "נפלו בין הכיסאות" list.
 *
 * Idempotent — checks for an existing open task before inserting.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmTasks } from "@/drizzle/schema";
import { GHL_SALESPERSON_USER_ID } from "@/integrations/ghl/config";
import { syncTaskToGHL } from "@/integrations/ghl/sync";
import type { V2AssignableStage } from "@/lib/manychat/stages";

export const AUTO_TASK_BY_STAGE: Partial<
  Record<V2AssignableStage, { title: string; hoursUntilDue: number }>
> = {
  INTAKE: { title: "פולואפ אחרי הצעה ראשונית", hoursUntilDue: 24 },
  DISCAVERY: { title: "להחליט אם לשלוח למפעל / לאלי", hoursUntilDue: 2 },
  FACTORY_WAIT: { title: "לעקוב אחר תשובת מפעל", hoursUntilDue: 24 },
  CONSIDERATION: { title: "פולואפ / לטפל בהתנגדות", hoursUntilDue: 4 },
  WON: { title: "ביצוע / גבייה / אישור קובץ", hoursUntilDue: 24 },
};

/**
 * Ensure the auto-task exists for this (lead, stage). No-op if:
 *   - the stage has no auto-task (NULL, LOST, side-stages)
 *   - the lead already has any open crm_tasks row (avoids duplicating on
 *     re-entry to the same stage or a race with setLeadStage)
 */
export async function ensureAutoTaskForStage(
  sid: string,
  stage: V2AssignableStage | null | undefined
): Promise<{ created: boolean; reason?: string }> {
  if (!stage) return { created: false, reason: "no stage" };
  const spec = AUTO_TASK_BY_STAGE[stage];
  if (!spec) return { created: false, reason: `no spec for ${stage}` };

  const [existing] = await db
    .select({ id: crmTasks.id })
    .from(crmTasks)
    .where(and(eq(crmTasks.manychatSubId, sid), isNull(crmTasks.completedAt)))
    .limit(1);
  if (existing) return { created: false, reason: "already has open task" };

  const dueAt = new Date(Date.now() + spec.hoursUntilDue * 60 * 60 * 1000);
  const [inserted] = await db
    .insert(crmTasks)
    .values({
      manychatSubId: sid,
      taskType: "follow_up",
      title: spec.title,
      status: "open",
      dueAt,
      // Default owner = Itay (GHL_SALESPERSON_USER_ID). Per Eli 2026-07-01
      // every task in the system belongs to Itay unless explicitly reassigned.
      assignedTo: GHL_SALESPERSON_USER_ID || null,
    })
    .returning({ id: crmTasks.id });

  // Push it to GHL immediately so Itay actually sees it — otherwise the task
  // lives only in the DB (invisible in GHL) yet the pipeline-audit counts it as
  // handled, so the lead falls between both chairs. Best-effort: if the lead has
  // no ghl_contact_id yet, the nightly sweep re-syncs once it does.
  if (inserted?.id) {
    try {
      await syncTaskToGHL(inserted.id);
    } catch (e) {
      console.error("[auto-task] GHL sync failed", inserted.id, e);
    }
  }
  return { created: true };
}

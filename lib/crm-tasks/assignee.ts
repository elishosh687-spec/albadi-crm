/**
 * WHO new work is assigned to — the one place that answers it.
 *
 * Everything the CRM creates in GHL (opportunities, contacts, tasks) used to be
 * hardwired to `GHL_SALESPERSON_USER_ID` (Itay) by the 2026-07-01 "every task
 * defaults to Itay" rule. Eli asked (2026-08-01) to be able to flip that between
 * himself and Itay from the settings screen without a redeploy, so the id now
 * lives in `app_config` and the env var is only the fallback.
 *
 * Server-only (touches the DB). Assignment sites should `await` this rather than
 * importing the env constant.
 */
import { db } from "@/lib/db";
import { appConfig, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { GHL_SALESPERSON_USER_ID } from "@/integrations/ghl/config";
import { getContact } from "@/integrations/ghl/client";

const KEY = "crm.assignee";

export interface StoredAssignee {
  /** GHL user id that owns new leads + tasks. */
  userId: string;
  /** Display name, cached for the settings UI (not authoritative). */
  name?: string;
  updatedAt?: string;
}

/** Read the configured assignee, or null when nothing is stored. */
export async function loadAssignee(): Promise<StoredAssignee | null> {
  try {
    const [row] = await db
      .select()
      .from(appConfig)
      .where(eq(appConfig.key, KEY))
      .limit(1);
    const v = row?.value as StoredAssignee | undefined;
    return v?.userId ? v : null;
  } catch {
    return null;
  }
}

/**
 * The GHL user id to assign new work to: the configured one, else the env
 * default (Itay), else null — callers already treat null as "leave unassigned".
 * Never throws: an assignment must not fail because config is unreadable.
 */
export async function resolveAssigneeUserId(): Promise<string | null> {
  const stored = await loadAssignee();
  return stored?.userId || GHL_SALESPERSON_USER_ID || null;
}

/** The GHL user who OWNS a contact (the pipeline-card owner), or null.
 *  Best-effort — a GHL hiccup must never block task creation. */
async function ghlContactOwner(ghlContactId: string | null | undefined): Promise<string | null> {
  if (!ghlContactId) return null;
  try {
    const c = await getContact(ghlContactId);
    return c?.assignedTo?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Who a TASK on a contact should be assigned to: the contact's ACTUAL GHL owner
 * (so a task on Itay's lead goes to Itay), falling back to the settings default
 * only when the lead has no owner yet (a brand-new lead). Eli 2026-08-02: auto
 * tasks were all landing on the settings person regardless of who owned the lead.
 */
export async function resolveTaskAssigneeByContact(
  ghlContactId: string | null | undefined
): Promise<string | null> {
  return (await ghlContactOwner(ghlContactId)) ?? (await resolveAssigneeUserId());
}

/** Same, resolving the lead's GHL contact id from its sid first. */
export async function resolveTaskAssigneeForSid(sid: string): Promise<string | null> {
  try {
    const [lead] = await db
      .select({ ghlContactId: leads.ghlContactId })
      .from(leads)
      .where(eq(leads.manychatSubId, sid))
      .limit(1);
    return resolveTaskAssigneeByContact(lead?.ghlContactId ?? null);
  } catch {
    return resolveAssigneeUserId();
  }
}

/** Persist the choice made in the settings screen. */
export async function setAssignee(userId: string, name?: string): Promise<void> {
  const value: StoredAssignee = {
    userId,
    name,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(appConfig)
    .values({ key: KEY, value })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * WHO new work is assigned to — the one place that answers it.
 *
 * Everything the CRM creates in GHL (opportunities, contacts, tasks) used to be
 * hardwired to `GHL_SALESPERSON_USER_ID` (Itay) by the 2026-07-01 "every task
 * defaults to Itay" rule. Eli asked (2026-08-01) to be able to flip that between
 * himself and Itay from the settings screen without a redeploy, so the id now
 * lives in `app_config` and the env var is only the fallback.
 *
 * 2026-08-03 — two assignment MODES (Eli): `single` (all new leads → one person)
 * or `round_robin` (lead #1 → member A, #2 → member B, #3 → A, …). The rotation
 * cursor advances exactly ONCE per lead — see `assignNextLeadOwner`.
 *
 * Server-only (touches the DB). Assignment sites should `await` this rather than
 * importing the env constant.
 */
import { db } from "@/lib/db";
import { appConfig, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { GHL_SALESPERSON_USER_ID } from "@/integrations/ghl/config";
import { getContact } from "@/integrations/ghl/client";

const KEY = "crm.assignee";

export type AssigneeMode = "single" | "round_robin";

export interface RotationMember {
  userId: string;
  name?: string;
}

export interface StoredAssignee {
  /** "single" (default, back-compat) or "round_robin". */
  mode?: AssigneeMode;
  /** single mode — the GHL user id that owns new leads + tasks. */
  userId?: string;
  /** Display name, cached for the settings UI (not authoritative). */
  name?: string;
  /** round_robin mode — members in rotation order. */
  rotation?: RotationMember[];
  /** round_robin mode — index of the LAST-assigned member (advances on each new lead). */
  cursor?: number;
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
    if (!v) return null;
    // Back-compat: a bare {userId} with no mode is single.
    if (v.mode === "round_robin") return v.rotation?.length ? v : null;
    return v.userId ? { ...v, mode: "single" } : null;
  } catch {
    return null;
  }
}

/**
 * The GHL user id to assign new work to WITHOUT advancing anything — a passive
 * default. In round_robin mode this returns the member last handed a lead (or
 * the first member), never advancing the cursor: it's the fallback for the many
 * task-resolution callers, which must have no side effects. New-lead OWNER
 * assignment goes through `assignNextLeadOwner` instead.
 * Never throws: an assignment must not fail because config is unreadable.
 */
export async function resolveAssigneeUserId(): Promise<string | null> {
  const stored = await loadAssignee();
  if (stored?.mode === "round_robin" && stored.rotation?.length) {
    const idx = ((stored.cursor ?? 0) % stored.rotation.length + stored.rotation.length) %
      stored.rotation.length;
    return stored.rotation[idx]?.userId || GHL_SALESPERSON_USER_ID || null;
  }
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

/**
 * Pick the OWNER for a brand-new lead and remember it — this is the ONLY place
 * that advances the round-robin cursor.
 *
 * Idempotent per lead: the first call for a sid picks + persists the owner on
 * `leads.owner_id` (a dead column repurposed as the "who we assigned" marker);
 * later calls for the SAME sid return that stored owner without advancing. This
 * matters because one lead's sync creates BOTH a contact and an opportunity —
 * both call this, but the cursor must move only once and the two must agree.
 *
 * - single mode → the configured user (no cursor).
 * - round_robin → the NEXT member (atomic `cursor = (cursor+1) % len`), so
 *   lead #1 → member[0], #2 → member[1], wrapping around.
 *
 * Never throws — falls back to `resolveAssigneeUserId()` on any error.
 */
export async function assignNextLeadOwner(sid: string): Promise<string | null> {
  try {
    // Already assigned for this lead? Reuse it (keeps contact == opportunity and
    // prevents a second sync from advancing the cursor again).
    const [existing] = await db
      .select({ ownerId: leads.ownerId })
      .from(leads)
      .where(eq(leads.manychatSubId, sid))
      .limit(1);
    if (existing?.ownerId) return existing.ownerId;

    const stored = await loadAssignee();

    let owner: string | null;
    if (stored?.mode === "round_robin" && stored.rotation?.length) {
      // Atomic advance: increment the cursor modulo rotation length in one
      // statement so concurrent new leads can't read the same cursor.
      const res = await db.execute(sql`
        UPDATE app_config
        SET value = jsonb_set(
              value,
              '{cursor}',
              to_jsonb(((COALESCE((value->>'cursor')::int, -1) + 1)
                        % jsonb_array_length(value->'rotation'))),
              true
            ),
            updated_at = now()
        WHERE key = ${KEY}
          AND value->>'mode' = 'round_robin'
          AND jsonb_array_length(value->'rotation') > 0
        RETURNING (value->>'cursor')::int AS cursor
      `);
      const nextCursor = (res.rows?.[0] as { cursor?: number } | undefined)?.cursor;
      const idx =
        typeof nextCursor === "number"
          ? ((nextCursor % stored.rotation.length) + stored.rotation.length) % stored.rotation.length
          : 0;
      owner = stored.rotation[idx]?.userId || GHL_SALESPERSON_USER_ID || null;
    } else {
      owner = stored?.userId || GHL_SALESPERSON_USER_ID || null;
    }

    // Remember who this lead went to (idempotency marker + audit).
    if (owner && sid) {
      await db
        .update(leads)
        .set({ ownerId: owner, updatedAt: new Date() })
        .where(eq(leads.manychatSubId, sid));
    }
    return owner;
  } catch (err) {
    console.error("[assignee] assignNextLeadOwner failed", sid, err);
    return resolveAssigneeUserId();
  }
}

/** Persist SINGLE-mode assignment (one person owns all new leads). */
export async function setAssignee(userId: string, name?: string): Promise<void> {
  const value: StoredAssignee = {
    mode: "single",
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

/**
 * Persist ROUND-ROBIN assignment. Resets the cursor to -1 so the FIRST new lead
 * after saving goes to `rotation[0]` (the order the members were listed).
 */
export async function setRoundRobin(rotation: RotationMember[]): Promise<void> {
  const clean = rotation
    .filter((m) => m && typeof m.userId === "string" && m.userId.trim())
    .map((m) => ({ userId: m.userId.trim(), name: m.name?.trim() || undefined }));
  const value: StoredAssignee = {
    mode: "round_robin",
    rotation: clean,
    cursor: -1,
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

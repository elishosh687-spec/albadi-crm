/**
 * Lead activity log writer + table bootstrapper.
 *
 * `logLeadEvent` writes a row to `lead_events`. The table is created
 * lazily on first call via CREATE TABLE IF NOT EXISTS so a fresh deploy
 * doesn't need a drizzle-kit push before the first event lands. After
 * that, the check is gated by a module-level flag so we don't pay the
 * round-trip on every write.
 *
 * Soft-fail contract: never throws. The actions that write events should
 * never be blocked by audit-log failures.
 */

import { db } from "@/lib/db";
import { leadEvents } from "@/drizzle/schema";
import { sql } from "drizzle-orm";

let bootstrapped = false;

async function ensureTable(): Promise<void> {
  if (bootstrapped) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lead_events (
        id SERIAL PRIMARY KEY,
        manychat_sub_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB,
        actor TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS lead_events_sid_created_idx
        ON lead_events (manychat_sub_id, created_at DESC)
    `);
    bootstrapped = true;
  } catch (e) {
    console.warn("[lead-events] ensureTable failed", e);
  }
}

export type LeadEventType =
  | "stage_change"
  | "note_added"
  | "note_deleted"
  | "note_edited"
  | "draft_approved"
  | "draft_rejected"
  | "manual_reply"
  | "manual_followup_set"
  | "manual_followup_cleared"
  | "lead_deleted"
  | "contact_updated"
  | "bot_paused"
  | "bot_resumed"
  | "configurator_link_sent"
  | "configurator_lead_created"
  | "configurator_design_saved"
  | "configurator_design_sent";

export async function logLeadEvent(input: {
  manychatSubId: string;
  eventType: LeadEventType;
  payload?: Record<string, unknown> | null;
  actor?: string | null;
}): Promise<void> {
  try {
    await ensureTable();
    const sid = input.manychatSubId.trim();
    if (!sid) return;
    await db.insert(leadEvents).values({
      manychatSubId: sid,
      eventType: input.eventType,
      payload: (input.payload ?? null) as any,
      actor: input.actor ?? "eli",
    });
  } catch (e) {
    // Audit log is best-effort.
    console.warn("[lead-events] logLeadEvent failed", e);
  }
}

export interface LeadEventRow {
  id: number;
  eventType: string;
  payload: Record<string, unknown> | null;
  actor: string | null;
  createdAt: string;
}

export async function loadLeadEvents(sid: string, limit = 50): Promise<LeadEventRow[]> {
  try {
    await ensureTable();
    const cleanSid = sid.trim();
    if (!cleanSid) return [];
    const res = await db.execute(sql`
      SELECT id, event_type AS "eventType", payload, actor, created_at AS "createdAt"
      FROM lead_events
      WHERE manychat_sub_id = ${cleanSid}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = ((res as unknown as { rows?: any[] }).rows ?? []) as any[];
    return rows.map((r) => ({
      id: Number(r.id),
      eventType: String(r.eventType),
      payload: (r.payload ?? null) as Record<string, unknown> | null,
      actor: r.actor ? String(r.actor) : null,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  } catch (e) {
    console.warn("[lead-events] loadLeadEvents failed", e);
    return [];
  }
}

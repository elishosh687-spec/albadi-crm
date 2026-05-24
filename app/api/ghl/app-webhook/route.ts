/**
 * POST /api/ghl/app-webhook
 *
 * Receives native webhook events from the GHL Marketplace App. Single
 * endpoint, signed with HMAC-SHA256 using GHL_APP_WEBHOOK_SECRET. Routes
 * to existing sync helpers based on event type.
 *
 * Setup (one-time, in GHL Marketplace dev portal):
 *   1. App settings → Webhooks → Add URL
 *      URL: https://albadi-crm.vercel.app/api/ghl/app-webhook
 *   2. Copy the signing secret GHL generates → paste into env as
 *      GHL_APP_WEBHOOK_SECRET
 *   3. Subscribe to events:
 *      ContactCreate, ContactUpdate, ContactDelete, ContactTagUpdate,
 *      OpportunityCreate, OpportunityUpdate, OpportunityDelete,
 *      NoteCreate, NoteUpdate, NoteDelete,
 *      TaskCreate, TaskUpdate, TaskDelete
 *
 * Once verified, the legacy UI-configured GHL Workflow → /api/ghl/resync
 * can be disabled (this endpoint covers everything the workflow did, plus
 * delete events that workflows can't trigger).
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { resyncContact, softDeleteContact } from "@/lib/ghl/resync-helper";
import { db } from "@/lib/db";
import { bridgeEvents, leads, leadTags } from "@/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { resetLeadAndRestart } from "@/lib/autoresponder/questionnaire";
import { removeContactTags } from "@/integrations/ghl/client";

// Tag names that, when added to a GHL contact, wipe the lead's bot state
// and re-send the bag-quote questionnaire from question 1. Case-insensitive
// match; Hebrew + English aliases accepted.
const RESTART_QUESTIONNAIRE_TAG_NAMES = new Set([
  "restart_questionnaire",
  "restart questionnaire",
  "restart_q",
  "restart bot",
  "התחל_מחדש",
  "התחל מחדש",
  "שאלון_מחדש",
  "שאלון מחדש",
  "שלח_שאלון",
  "שלח שאלון",
]);

function findRestartTag(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (typeof t !== "string") continue;
    if (RESTART_QUESTIONNAIRE_TAG_NAMES.has(t.trim().toLowerCase())) return t;
  }
  return null;
}

export const runtime = "nodejs";
export const maxDuration = 30;

interface AppWebhookEvent {
  type: string;
  locationId?: string;
  id?: string;           // entity id (contact id / opportunity id / etc.)
  contactId?: string;    // for child entities (note/task)
  timestamp?: string;
  webhookId?: string;
  [k: string]: unknown;
}

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const secret = process.env.GHL_APP_WEBHOOK_SECRET || "";
  const signature = req.headers.get("x-wh-signature") || req.headers.get("x-ghl-signature");

  // If secret not configured yet, log + accept (so we can debug payload shape
  // before locking down). Remove this branch once secret is in env.
  if (secret) {
    if (!verifySignature(rawBody, signature, secret)) {
      console.warn("[ghl.app-webhook] invalid signature", { signature: signature?.slice(0, 12) });
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  } else {
    console.warn("[ghl.app-webhook] GHL_APP_WEBHOOK_SECRET not set — accepting unsigned (DEV ONLY)");
  }

  let event: AppWebhookEvent;
  try {
    event = JSON.parse(rawBody) as AppWebhookEvent;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // Audit log every event for replay/debug.
  const evtId = `app:${event.webhookId || `${event.type}:${event.id || ""}:${Date.now()}`}`;
  try {
    await db.insert(bridgeEvents).values({
      evtId,
      type: `ghl_app.${event.type}`,
      tenant: event.locationId ?? null,
      occurredAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      payload: event as any,
    });
  } catch {
    // dedupe — same evtId already logged, ignore.
  }

  const type = event.type;
  console.log(`[ghl.app-webhook] ${type}`, { id: event.id, contactId: event.contactId });

  // ============================================================
  // Contact-tag updates — first check for restart-questionnaire trigger
  // before the generic resync, so we wipe + send the first poll without
  // any extra workflow setup on GHL's side.
  // ============================================================
  if (type === "ContactTagUpdate") {
    const contactId = event.id;
    if (!contactId) return NextResponse.json({ error: "missing_contact_id" }, { status: 400 });
    const restartTag = findRestartTag(event.tags);
    if (restartTag) {
      const [row] = await db
        .select({ sid: leads.manychatSubId })
        .from(leads)
        .where(eq(leads.ghlContactId, contactId))
        .limit(1);
      if (!row) {
        console.warn(`[ghl.app-webhook] restart tag '${restartTag}' but no lead for contactId=${contactId}`);
        return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
      }
      const sid = row.sid;
      try {
        await resetLeadAndRestart(sid);
        console.log(`[ghl.app-webhook] restart-questionnaire triggered for sid=${sid} via tag '${restartTag}'`);
      } catch (err) {
        console.error(`[ghl.app-webhook] restart-questionnaire failed for ${sid}`, err);
        return NextResponse.json(
          {
            ok: false,
            error: "restart_failed",
            detail: err instanceof Error ? err.message : String(err),
          },
          { status: 500 }
        );
      }
      // Strip the tag from GHL + DB so re-adding it later re-triggers cleanly
      // and the next resync doesn't loop into another restart.
      try {
        await removeContactTags(contactId, [restartTag]);
      } catch (err) {
        console.warn(`[ghl.app-webhook] removeContactTags failed for ${contactId}`, err);
      }
      try {
        await db
          .delete(leadTags)
          .where(and(sql`trim(${leadTags.manychatSubId}) = ${sid.trim()}`, eq(leadTags.tag, restartTag)));
      } catch (err) {
        console.warn(`[ghl.app-webhook] local tag cleanup failed for ${sid}`, err);
      }
      // Fall through to resync so DB reflects the new (post-cleanup) tag set.
      const r = await resyncContact(contactId, "ghl_app_webhook");
      return NextResponse.json({ ...r, ok: true, applied: "restart_questionnaire", sid });
    }
    // Plain tag update — just resync to mirror tag state into DB.
    const r = await resyncContact(contactId, "ghl_app_webhook");
    return NextResponse.json(r);
  }

  // ============================================================
  // Other contact events — resync the contact (covers field changes)
  // ============================================================
  if (
    type === "ContactCreate" ||
    type === "ContactUpdate" ||
    type === "ContactDndUpdate"
  ) {
    const contactId = event.id;
    if (!contactId) return NextResponse.json({ error: "missing_contact_id" }, { status: 400 });
    const r = await resyncContact(contactId, "ghl_app_webhook");
    return NextResponse.json(r);
  }

  if (type === "ContactDelete") {
    const contactId = event.id;
    if (!contactId) return NextResponse.json({ error: "missing_contact_id" }, { status: 400 });
    const r = await softDeleteContact(contactId);
    return NextResponse.json({ ok: true, type, ...r });
  }

  // ============================================================
  // Opportunity events — resync via contactId (opp data picked up
  // by listOpportunitiesForContact in the resync flow)
  // ============================================================
  if (
    type === "OpportunityCreate" ||
    type === "OpportunityUpdate" ||
    type === "OpportunityStageUpdate" ||
    type === "OpportunityStatusUpdate" ||
    type === "OpportunityMonetaryValueUpdate"
  ) {
    const contactId = (event as { contactId?: string }).contactId;
    if (!contactId) {
      return NextResponse.json({ error: "missing_contact_id_on_opp_event" }, { status: 400 });
    }
    const r = await resyncContact(contactId, "ghl_app_webhook");
    return NextResponse.json(r);
  }

  if (type === "OpportunityDelete") {
    // Opportunity is independent of contact survival — don't soft-delete lead
    // here. Just resync to refresh state (opportunity will simply be absent).
    const contactId = (event as { contactId?: string }).contactId;
    if (contactId) {
      const r = await resyncContact(contactId, "ghl_app_webhook");
      return NextResponse.json(r);
    }
    return NextResponse.json({ ok: true, type, noted: true });
  }

  // ============================================================
  // Note + Task events — resync to pick up changes (helper re-reads
  // all notes/tasks fresh from GHL on every resync)
  // ============================================================
  if (
    type === "NoteCreate" || type === "NoteUpdate" || type === "NoteDelete" ||
    type === "TaskCreate" || type === "TaskUpdate" || type === "TaskDelete"
  ) {
    const contactId = (event as { contactId?: string }).contactId;
    if (!contactId) return NextResponse.json({ error: "missing_contact_id" }, { status: 400 });
    const r = await resyncContact(contactId, "ghl_app_webhook");
    return NextResponse.json(r);
  }

  // ============================================================
  // Unknown / unhandled — audit-log already done, return ok.
  // ============================================================
  return NextResponse.json({ ok: true, type, noted: true, handled: false });
}

// GHL may probe with GET on the URL during setup.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, endpoint: "ghl.app-webhook" });
}

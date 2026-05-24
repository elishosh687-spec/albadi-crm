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
import { restartQuestionnaire } from "@/lib/autoresponder/questionnaire";
import { removeContactTags } from "@/integrations/ghl/client";

// Cooldown window (ms) — if the same lead got a restart within this window,
// we skip a fresh one. Defends against GHL webhook retries that fire while
// `restartQuestionnaire` is still mid-flight (it does 3 sequential bridge
// sends with ~800ms sleeps, easily 3-6s — long enough for a retry to land).
const RESTART_COOLDOWN_MS = 60_000;

// Tag names that, when added to a GHL contact, wipe the lead's bot state
// and re-send the bag-quote questionnaire from question 1. Case-insensitive
// match; Hebrew + English aliases accepted.
const RESTART_QUESTIONNAIRE_TAG_NAMES = new Set([
  "restart_questionnaire",
  "restart questionnaire",
  "restart_q",
  "restart bot",
  "start over",
  "start_over",
  "startover",
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

  // Audit log + idempotency dedupe. If the same webhookId arrives twice
  // (GHL retry on timeout, duplicate dispatch) we bail before doing any
  // work — bridge_events.evtId has a UNIQUE constraint and the returning()
  // call gives us back zero rows on conflict.
  const evtId = `app:${event.webhookId || `${event.type}:${event.id || ""}:${event.timestamp || Date.now()}`}`;
  const inserted = await db
    .insert(bridgeEvents)
    .values({
      evtId,
      type: `ghl_app.${event.type}`,
      tenant: event.locationId ?? null,
      occurredAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      payload: event as any,
    })
    .onConflictDoNothing({ target: bridgeEvents.evtId })
    .returning({ evtId: bridgeEvents.evtId });
  if (inserted.length === 0) {
    console.log(`[ghl.app-webhook] dedup skip evtId=${evtId}`);
    return NextResponse.json({ ok: true, deduped: true });
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
        .select({
          sid: leads.manychatSubId,
          lastFollowUpAt: leads.lastFollowUpAt,
        })
        .from(leads)
        .where(eq(leads.ghlContactId, contactId))
        .limit(1);
      if (!row) {
        console.warn(`[ghl.app-webhook] restart tag '${restartTag}' but no lead for contactId=${contactId}`);
        return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
      }
      const sid = row.sid;

      // Cooldown defense — if we restarted this lead within the cooldown
      // window, skip. Covers the rare case where webhook dedupe fails
      // (e.g. GHL replays with a new webhookId for the same logical event).
      const recentlyRestarted =
        row.lastFollowUpAt &&
        Date.now() - new Date(row.lastFollowUpAt).getTime() < RESTART_COOLDOWN_MS;
      if (recentlyRestarted) {
        console.log(`[ghl.app-webhook] restart cooldown active for sid=${sid}, skipping`);
        // Still attempt the tag removal — the previous run may have failed
        // there and we don't want the tag stranded on the contact.
        try {
          await removeContactTags(contactId, [restartTag]);
        } catch (err) {
          console.warn(`[ghl.app-webhook] removeContactTags (cooldown branch) failed`, err);
        }
        return NextResponse.json({
          ok: true,
          sid,
          applied: "restart_cooldown_skip",
        });
      }

      // Remove the tag BEFORE running the slow restart so any GHL retry
      // that lands mid-flight sees a clean tags array (findRestartTag will
      // return null) and won't double-fire. Local lead_tags mirror cleanup
      // is best-effort.
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

      try {
        // Minimal restart — only resets qState + follow-up bookkeeping and
        // sends the first poll. Pipeline stage, factory draft, quote totals,
        // bot summary etc are preserved so an existing customer asking for
        // a re-quote (e.g. different size) doesn't lose prior history.
        await restartQuestionnaire(
          sid,
          "שולח לך את השאלון שוב 🙂 ענה על מה שהשתנה ואכין הצעה חדשה."
        );
        console.log(`[ghl.app-webhook] restart-questionnaire fired for sid=${sid} via tag '${restartTag}'`);
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
      return NextResponse.json({ ok: true, applied: "restart_questionnaire", sid });
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

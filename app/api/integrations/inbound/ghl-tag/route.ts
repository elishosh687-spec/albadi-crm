/**
 * POST /api/integrations/inbound/ghl-tag
 *
 * GHL Workflow → webhook when a tag is added or removed from a contact.
 * Auth: Authorization: Bearer <GHL_INBOUND_SECRET>
 *
 * Expected body:
 *   {
 *     "contactId": "{{contact.id}}",   // OR omit and use "phone"
 *     "phone":     "{{contact.phone}}", // alt match (E.164)
 *     "tag":       "bot_paused",        // tag name (Hebrew or English)
 *     "action":    "added" | "removed"
 *   }
 *
 * Supported tag names (case-insensitive, also matches Hebrew aliases):
 *   - "bot_paused" / "עצור_בוט" → toggles leads.bot_paused
 *
 * Side effects: writes to lead_tags as well so the DB tag state stays in
 * sync with GHL. Bot logic reads bot_paused boolean.
 *
 * GHL Workflow setup (two workflows):
 *   1. "Contact Tag Applied" → tag = bot_paused → Webhook POST {"action":"added", ...}
 *   2. "Contact Tag Removed" → tag = bot_paused → Webhook POST {"action":"removed", ...}
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, leadTags } from "@/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { GHL_INBOUND_SECRET } from "@/integrations/ghl/config";
import { resetLeadAndRestart } from "@/lib/autoresponder/questionnaire";
import { removeContactTags } from "@/integrations/ghl/client";

export const runtime = "nodejs";

function verifyAuth(req: NextRequest): boolean {
  if (!GHL_INBOUND_SECRET) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === GHL_INBOUND_SECRET;
}

// Tag-name → effect mapping. Add Hebrew aliases as Eli creates them in GHL.
const BOT_PAUSE_TAG_NAMES = new Set([
  "bot_paused",
  "bot paused",
  "botpaused",
  "עצור_בוט",
  "עצור בוט",
  "השהה_בוט",
  "השהה בוט",
  "בוט_מושהה",
]);

// When any of these tags is *added* to a contact, we wipe the lead's bot
// state and resend the questionnaire from question 1, then strip the tag
// from GHL so re-adding it later re-triggers the flow.
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

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function isBotPauseTag(tag: string): boolean {
  return BOT_PAUSE_TAG_NAMES.has(normalize(tag));
}

function isRestartTag(tag: string): boolean {
  return RESTART_QUESTIONNAIRE_TAG_NAMES.has(normalize(tag));
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text();
  console.log("[ghl-tag] raw body", rawBody.slice(0, 500));

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const rawPhone =
    typeof body.phone === "string" ? body.phone.trim().replace(/^\+/, "") : "";
  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";

  if (!contactId && !rawPhone) {
    return NextResponse.json(
      { ok: false, error: "missing contactId or phone" },
      { status: 400 }
    );
  }
  if (!tag) {
    return NextResponse.json({ ok: false, error: "missing tag" }, { status: 400 });
  }
  if (action !== "added" && action !== "removed") {
    return NextResponse.json(
      { ok: false, error: "action must be 'added' or 'removed'" },
      { status: 400 }
    );
  }

  const whereLead = contactId
    ? eq(leads.ghlContactId, contactId)
    : eq(leads.phoneE164, rawPhone);

  const [row] = await db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(whereLead)
    .limit(1);

  if (!row) {
    console.warn("[ghl-tag] no lead found", { contactId, rawPhone });
    return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });
  }

  const sid = row.sid;

  // Mirror tag into lead_tags table regardless of meaning.
  if (action === "added") {
    const existing = await db
      .select({ id: leadTags.id })
      .from(leadTags)
      .where(and(sql`trim(${leadTags.manychatSubId}) = ${sid.trim()}`, eq(leadTags.tag, tag)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(leadTags).values({ manychatSubId: sid, tag });
    }
  } else {
    await db
      .delete(leadTags)
      .where(and(sql`trim(${leadTags.manychatSubId}) = ${sid.trim()}`, eq(leadTags.tag, tag)));
  }

  // Apply special semantics for known control tags.
  if (isBotPauseTag(tag)) {
    const paused = action === "added";
    await db
      .update(leads)
      .set({ botPaused: paused, updatedAt: new Date() })
      .where(eq(leads.manychatSubId, sid));
    console.log(`[ghl-tag] bot_paused=${paused} for ${sid} via tag '${tag}'`);
    return NextResponse.json({
      ok: true,
      sid,
      tag,
      action,
      botPaused: paused,
    });
  }

  if (isRestartTag(tag) && action === "added") {
    try {
      await resetLeadAndRestart(sid);
      console.log(`[ghl-tag] restart-questionnaire triggered for ${sid} via tag '${tag}'`);
    } catch (err) {
      console.error(`[ghl-tag] restart-questionnaire failed for ${sid}`, err);
      return NextResponse.json(
        {
          ok: false,
          sid,
          tag,
          action,
          error: "restart_failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 }
      );
    }
    // Strip the tag from GHL + DB so adding it again later re-fires this
    // handler. Failures here are non-fatal — the questionnaire already
    // restarted.
    if (contactId) {
      try {
        await removeContactTags(contactId, [tag]);
      } catch (err) {
        console.warn(`[ghl-tag] removeContactTags failed for ${contactId}`, err);
      }
    }
    try {
      await db
        .delete(leadTags)
        .where(and(sql`trim(${leadTags.manychatSubId}) = ${sid.trim()}`, eq(leadTags.tag, tag)));
    } catch (err) {
      console.warn(`[ghl-tag] local tag cleanup failed for ${sid}`, err);
    }
    return NextResponse.json({
      ok: true,
      sid,
      tag,
      action,
      applied: "restart_questionnaire",
    });
  }

  // Unknown tag — still mirrored above, but no side effect.
  console.log(`[ghl-tag] mirrored tag '${tag}' (${action}) for ${sid} — no special semantics`);
  return NextResponse.json({ ok: true, sid, tag, action, applied: "tag_only" });
}

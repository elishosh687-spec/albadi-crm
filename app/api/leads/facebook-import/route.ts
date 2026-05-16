/**
 * POST /api/leads/facebook-import
 *
 * Replaces the old Google Apps Script → ManyChat pipeline. Called from a
 * Google Apps Script attached to the Facebook lead-form spreadsheet.
 *
 * Auth: `Authorization: Bearer ${FB_IMPORT_SECRET}` — a dedicated secret so
 * we never expose the bridge tenant token to Apps Script.
 *
 * Body:
 *   { phone: "+972XXXXXXXXX" | "972XXXXXXXXX", fullName: "First Last" }
 *
 * Behaviour (mirrors the old ManyChat dedupe — important: don't double-text
 * customers who already initiated WhatsApp via the FB form's WA button):
 *   - Lead exists in DB (by waJid or phoneE164)
 *       → add tag "ליד_חדש" if missing, set leadSource="facebook" if null.
 *         Do NOT send OPENING. Return { status: "tagged_only" }.
 *   - Lead does not exist
 *       → insert leads row, add tag, set leadSource, send OPENING via bridge.
 *         Return { status: "sent" }.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, leadTags } from "@/drizzle/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { OPENING } from "@/lib/autoresponder/questionnaire";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  phone: z.string().min(7),
  fullName: z.string().min(1),
});

const FB_LEAD_TAG = "ליד_חדש";
const FB_LEAD_SOURCE = "facebook";

function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

function jidFromPhone(phone: string): string {
  return `${digitsOnly(phone)}@s.whatsapp.net`;
}

export async function POST(req: NextRequest) {
  const secret = (process.env.FB_IMPORT_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json(
      { error: "FB_IMPORT_SECRET not configured" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }

  const phone = digitsOnly(body.phone);
  if (!phone || phone.length < 7) {
    return NextResponse.json(
      { error: "invalid_phone", detail: body.phone },
      { status: 400 }
    );
  }
  const jid = jidFromPhone(phone);
  const name = body.fullName.trim();

  // 1. Check existing lead. WhatsApp leads come in via the bridge as a @lid
  //    or @s.whatsapp.net JID — match either, and also by stored phone.
  const existing = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      leadSource: leads.leadSource,
    })
    .from(leads)
    .where(
      or(
        eq(leads.phoneE164, phone),
        eq(leads.waJid, jid)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    // Add tag idempotently.
    const hasTag = await db
      .select({ id: leadTags.id })
      .from(leadTags)
      .where(
        and(
          sql`trim(${leadTags.manychatSubId}) = ${row.sid.trim()}`,
          eq(leadTags.tag, FB_LEAD_TAG)
        )
      )
      .limit(1);
    if (hasTag.length === 0) {
      await db
        .insert(leadTags)
        .values({ manychatSubId: row.sid, tag: FB_LEAD_TAG });
    }
    // Set leadSource only if not already set — preserve manual overrides.
    if (!row.leadSource) {
      await db
        .update(leads)
        .set({ leadSource: FB_LEAD_SOURCE, updatedAt: new Date() })
        .where(sql`trim(${leads.manychatSubId}) = ${row.sid.trim()}`);
    }
    return NextResponse.json({
      status: "tagged_only",
      sid: row.sid,
      reason: "lead_already_exists",
    });
  }

  // 2. New lead — insert, tag, send OPENING.
  //    We key the lead on the @s.whatsapp.net JID. When/if the customer
  //    later sends a real message and the bridge resolves to a different
  //    LID, the webhook's upsert reconciles via `waJid = sid`.
  try {
    await db.insert(leads).values({
      manychatSubId: jid,
      waJid: jid,
      name,
      phoneE164: phone,
      source: "facebook_import",
      leadSource: FB_LEAD_SOURCE,
      active: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "lead_insert_failed", detail: String(err) },
      { status: 500 }
    );
  }

  try {
    await db.insert(leadTags).values({ manychatSubId: jid, tag: FB_LEAD_TAG });
  } catch (err) {
    // Tag insert failure is non-fatal — the lead row exists.
    console.warn("[fb-import] tag insert failed", err);
  }

  try {
    await sendBridgeMessage(jid, OPENING, undefined, "bot");
  } catch (err) {
    // Bridge send failure: lead row + tag are persisted, but the customer
    // didn't get the opening. Caller (Apps Script) sees `send_failed` and
    // can retry; the dedupe path will not re-send because the lead already
    // exists, so a retry needs different handling — emit explicit error.
    return NextResponse.json(
      {
        status: "lead_created_send_failed",
        sid: jid,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    status: "sent",
    sid: jid,
    phone,
    name,
  });
}

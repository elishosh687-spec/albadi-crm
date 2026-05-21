/**
 * Phase 1F — Outbound chat receiver.
 *
 * Triggered by a GHL Workflow:
 *   trigger:  Conversation → Outbound message
 *   action:   Webhook → POST <this URL>
 *   headers:  Authorization: Bearer <GHL_OUTBOUND_WEBHOOK_SECRET>
 *   body:     {
 *               "contactId": "{{contact.id}}",
 *               "phone":     "{{contact.phone}}",
 *               "message":   "{{message.body}}"
 *             }
 *
 * Flow:
 *   1. Verify Bearer matches GHL_OUTBOUND_WEBHOOK_SECRET (constant-time).
 *   2. Lookup lead by ghl_contact_id (preferred) or phone (fallback).
 *   3. Call sendBridgeMessage(jid, text, undefined, "eli"). This routes
 *      through GreenAPI when USE_GREEN_API=1; the helper inserts the
 *      outbound row in `messages` with sender='eli' automatically.
 *
 * Idempotency: messages are not deduped on this surface. If GHL retries
 * the webhook, the customer will receive the message twice. GHL Workflow
 * retry policy: 3 attempts with 1-min backoff on non-2xx. We return 200
 * once the bridge send succeeds and 4xx on bad input (no retry) to keep
 * dupes minimal.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq, or, sql } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";

export const runtime = "nodejs";
export const maxDuration = 15;

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

function bearerOk(header: string | null): boolean {
  const expected = readEnv("GHL_OUTBOUND_WEBHOOK_SECRET");
  if (!expected) return false;
  if (!header) return false;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const got = Buffer.from(m[1].trim());
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

interface OutboundPayload {
  contactId?: string;
  phone?: string;
  message?: string;
  // GHL field-merge sometimes wraps each var in quotes/whitespace; tolerate.
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!bearerOk(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: OutboundPayload;
  try {
    payload = (await req.json()) as OutboundPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const contactId = payload.contactId?.trim();
  const phone = payload.phone ? normalizePhone(payload.phone) : null;
  const text = payload.message?.trim();

  if (!text) {
    return NextResponse.json({ error: "missing message" }, { status: 400 });
  }
  if (!contactId && !phone) {
    return NextResponse.json(
      { error: "missing contactId and phone" },
      { status: 400 }
    );
  }

  // Find the lead. Prefer ghl_contact_id (set by backfill); fall back to
  // phone match for leads still unmapped.
  const conditions = [];
  if (contactId) conditions.push(eq(leads.ghlContactId, contactId));
  if (phone) {
    conditions.push(eq(leads.phoneE164, phone));
    // Tolerate alt format (without leading +).
    conditions.push(eq(leads.phoneE164, phone.replace(/^\+/, "")));
  }
  const [lead] = await db
    .select({
      manychatSubId: leads.manychatSubId,
      phoneE164: leads.phoneE164,
      waJid: leads.waJid,
    })
    .from(leads)
    .where(or(...conditions))
    .limit(1);

  if (!lead) {
    return NextResponse.json(
      { error: "lead not found", contactId, phone },
      { status: 404 }
    );
  }

  // sendBridgeMessage accepts a phone OR jid; the helper normalizes
  // internally to whichever backend is active (bridge or GreenAPI).
  const recipient = lead.waJid || lead.phoneE164;
  if (!recipient) {
    return NextResponse.json(
      { error: "lead has no waJid or phone" },
      { status: 422 }
    );
  }

  try {
    const result = await sendBridgeMessage(
      recipient,
      text,
      undefined,
      "eli"
    );
    return NextResponse.json({
      ok: true,
      wa_message_id: result.wa_message_id,
      lead_sid: lead.manychatSubId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ghl.outbound] send failed", lead.manychatSubId, msg);
    return NextResponse.json({ error: "send failed", detail: msg }, { status: 502 });
  }
}

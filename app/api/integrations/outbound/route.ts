/**
 * Phase 1F — Outbound chat receiver (GHL Custom Conversation Provider).
 *
 * GHL POSTs here when Eli sends a message in the GHL Inbox tagged with our
 * "Albadi WhatsApp" provider. Payload shape (LCO standard, subject to
 * variation across GHL releases):
 *   {
 *     locationId, messageId, type: "Custom",
 *     contactId, userId, message, attachments?, phone?, altId?
 *   }
 *
 * Flow:
 *   1. Log raw headers + body (until GHL signature format confirmed).
 *   2. Lookup lead by ghl_contact_id (preferred) or phone (fallback).
 *   3. Call sendBridgeMessage(jid, text, undefined, "eli"). This routes
 *      through GreenAPI when USE_GREEN_API=1; the helper inserts the
 *      outbound row in `messages` with sender='eli' automatically.
 *
 * TODO auth: GHL Conversation Provider webhooks do not carry a Bearer we can
 * preset. Need HMAC verification with GHL_OAUTH_CLIENT_SECRET once header
 * format is known. For now we accept any POST that maps to an existing lead,
 * and reject unknown contactIds with 404. Risk: attacker who knows a
 * ghl_contact_id can trigger sends. Mitigation pending.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq, or } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";

export const runtime = "nodejs";
export const maxDuration = 15;

interface GHLOutboundPayload {
  // Fields observed in GHL Custom Provider webhooks. All are tolerated as
  // optional; we extract whichever is present.
  locationId?: string;
  contactId?: string;
  conversationId?: string;
  messageId?: string;
  userId?: string;
  type?: string;
  message?: string;
  body?: string; // some versions use `body` instead of `message`
  text?: string; // tolerated alternative
  phone?: string;
  attachments?: string[];
  altId?: string;
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

function extractText(p: GHLOutboundPayload): string | null {
  const v = p.message ?? p.body ?? p.text;
  return v ? v.trim() || null : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headerSnapshot: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (
      k.startsWith("x-") ||
      k === "authorization" ||
      k === "content-type" ||
      k === "user-agent"
    ) {
      headerSnapshot[k] = v;
    }
  });
  console.log("[ghl.outbound] hit", {
    headers: headerSnapshot,
    body: rawBody.slice(0, 1000),
  });

  let payload: GHLOutboundPayload;
  try {
    payload = JSON.parse(rawBody) as GHLOutboundPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const contactId = payload.contactId?.trim();
  const phone = payload.phone ? normalizePhone(payload.phone) : null;
  const text = extractText(payload);

  if (!text) {
    console.warn("[ghl.outbound] no text in payload", payload);
    return NextResponse.json({ error: "missing message" }, { status: 400 });
  }
  if (!contactId && !phone) {
    return NextResponse.json(
      { error: "missing contactId and phone" },
      { status: 400 }
    );
  }

  const conditions = [] as ReturnType<typeof eq>[];
  if (contactId) conditions.push(eq(leads.ghlContactId, contactId));
  if (phone) {
    conditions.push(eq(leads.phoneE164, phone));
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
    console.warn("[ghl.outbound] lead not found", { contactId, phone });
    return NextResponse.json(
      { error: "lead not found", contactId, phone },
      { status: 404 }
    );
  }

  const recipient = lead.waJid || lead.phoneE164;
  if (!recipient) {
    return NextResponse.json(
      { error: "lead has no waJid or phone" },
      { status: 422 }
    );
  }

  try {
    const result = await sendBridgeMessage(recipient, text, undefined, "eli");
    console.log("[ghl.outbound] sent", {
      sid: lead.manychatSubId,
      wa_message_id: result.wa_message_id,
    });
    return NextResponse.json({
      ok: true,
      wa_message_id: result.wa_message_id,
      lead_sid: lead.manychatSubId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ghl.outbound] send failed", lead.manychatSubId, msg);
    return NextResponse.json(
      { error: "send failed", detail: msg },
      { status: 502 }
    );
  }
}

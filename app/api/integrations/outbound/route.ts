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
 * AUTH (added 2026-08-16 — this endpoint sends a real WhatsApp message to a
 * real customer, and until now it accepted any POST that mapped to an existing
 * lead; anyone who knew a ghl_contact_id could make us message that customer).
 *
 * GHL Custom Provider webhooks carry no signature we can verify, but the
 * delivery URL is ours to define, so the secret rides in it:
 *   https://…/api/integrations/outbound?secret=<GHL_OUTBOUND_SECRET>
 * `Authorization: Bearer <secret>` is accepted too.
 *
 * It fails OPEN while GHL_OUTBOUND_SECRET is unset, because this path carries
 * live traffic (tens of Eli's Inbox replies a day) and a hard requirement
 * shipped ahead of the configuration would silently stop his replies reaching
 * customers. Unauthenticated hits are logged loudly and audited to
 * `bridge_events` so the gap is visible rather than assumed closed. Setting
 * the env var and appending the query param closes it, in either order.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, messages, bridgeEvents } from "@/drizzle/schema";
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
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

/** Constant-time compare — the secret travels in a URL, so don't leak length-wise. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

type AuthOutcome = { ok: true; mode: "verified" | "unconfigured" } | { ok: false };

function checkAuth(req: NextRequest): AuthOutcome {
  const expected = process.env.GHL_OUTBOUND_SECRET?.trim();
  if (!expected) return { ok: true, mode: "unconfigured" };
  const fromQuery = req.nextUrl.searchParams.get("secret")?.trim() ?? "";
  const fromHeader = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const given = fromQuery || fromHeader;
  if (given && secretMatches(given, expected)) return { ok: true, mode: "verified" };
  return { ok: false };
}

function extractText(p: GHLOutboundPayload): string | null {
  const v = p.message ?? p.body ?? p.text;
  return v ? v.trim() || null : null;
}

// The labels forwardMessage() prefixes onto every mirrored message so the GHL
// Inbox shows who spoke. They exist ONLY inside GHL — a real human typing in
// the Inbox never produces them, so their presence is proof this payload is
// our own mirror coming back through the delivery callback.
const MIRROR_LABELS = ["🤖 בוט", "📤 אלי", "📥 לקוח"];

function stripMirrorLabel(text: string): { body: string; wasLabelled: boolean } {
  for (const label of MIRROR_LABELS) {
    if (text.startsWith(label)) {
      return { body: text.slice(label.length).replace(/^\n/, "").trim(), wasLabelled: true };
    }
  }
  return { body: text, wasLabelled: false };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = checkAuth(req);
  if (!auth.ok) {
    console.warn("[ghl.outbound] rejected — bad or missing secret");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  // Free extra check, no configuration needed: a delivery for our provider
  // always carries our own location. It is weaker than the secret (a location
  // id is semi-public), but it costs nothing and narrows the window while the
  // secret is still unset.
  const ourLocation = process.env.GHL_LOCATION_ID?.trim();
  if (ourLocation && payload.locationId && payload.locationId.trim() !== ourLocation) {
    console.warn("[ghl.outbound] rejected — foreign locationId", payload.locationId);
    return NextResponse.json({ error: "unknown location" }, { status: 403 });
  }

  // Make the unauthenticated state visible instead of assumed-closed. One row
  // per hit, so "is anyone still calling this without the secret?" is a query,
  // not a guess.
  if (auth.mode === "unconfigured") {
    console.warn(
      "[ghl.outbound] UNAUTHENTICATED HIT — GHL_OUTBOUND_SECRET is not set; " +
        "this endpoint sends real WhatsApp messages. Set the env var and append " +
        "?secret=… to the provider delivery URL in GHL."
    );
    try {
      await db.insert(bridgeEvents).values({
        evtId: `ghl_outbound_open:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        type: "ghl_outbound.unauthenticated",
        occurredAt: new Date(),
        payload: {
          contactId: payload.contactId ?? null,
          locationId: payload.locationId ?? null,
          userAgent: headerSnapshot["user-agent"] ?? null,
        } as unknown as Record<string, unknown>,
      });
    } catch {
      // Auditing must never block a legitimate reply from reaching a customer.
    }
  }

  const contactId = payload.contactId?.trim();
  const phone = payload.phone ? normalizePhone(payload.phone) : null;
  const text = extractText(payload);
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments.filter((u) => typeof u === "string" && u.trim())
    : [];
  const mediaUrl = attachments[0] ?? null;
  if (attachments.length > 1) {
    console.warn(
      "[ghl.outbound] multiple attachments — only first will be sent",
      attachments.length
    );
  }

  if (!text && !mediaUrl) {
    console.warn("[ghl.outbound] no text or media in payload", payload);
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

  // Dedup safety net — block the GHL delivery-callback loop.
  //
  // When our mirror posts an outbound to /conversations/messages, GHL stores
  // the message AND fires the Custom Provider deliveryUrl webhook (= this
  // endpoint) so the provider can actually deliver to the customer. Without
  // dedup, we'd re-send our own mirror to the customer.
  //
  // Layer 1 (primary, works for text + media): match GHL messageId against
  // the ghl_mirror.success audit rows our forwardMessage writes. Exact 1:1.
  // GHL Inbox UI sends DON'T appear in that audit, so this only catches
  // self-callbacks.
  const ghlMessageId = payload.messageId?.trim();
  if (ghlMessageId) {
    const seen = await db
      .select({ id: bridgeEvents.id, payload: bridgeEvents.payload })
      .from(bridgeEvents)
      .where(
        and(
          eq(bridgeEvents.type, "ghl_mirror.success"),
          sql`payload->>'messageId' = ${ghlMessageId}`,
          gt(bridgeEvents.occurredAt, sql`now() - interval '5 minutes'`)
        )
      )
      .limit(1);
    if (seen.length > 0) {
      console.log("[ghl.outbound] dedup skip — messageId is our own mirror", {
        sid: lead.manychatSubId,
        ghlMessageId,
      });
      return NextResponse.json({
        ok: true,
        skipped: "dedup_messageId",
        ghlMessageId,
        lead_sid: lead.manychatSubId,
      });
    }
  }

  // Layer 1b: the payload still carries our Inbox label ("🤖 בוט\n…").
  //
  // This is the layer that was missing, and it let the loop through for two
  // months: Layer 1 needs GHL to echo back the same messageId (it often
  // doesn't) and Layer 2 compared the RAW text — which never matched, because
  // the mirror had prefixed a label onto it. So every labelled bot message was
  // re-sent to the customer, arriving a second time with "🤖 בוט" stuck on
  // top. 76 such messages reached 39 real customers before this check existed
  // (Eli 2026-08-16: "שולח את הסקר שוב ושוב"). A label is unambiguous — no
  // human types one — so it alone is enough to drop the payload.
  if (text) {
    const { wasLabelled } = stripMirrorLabel(text);
    if (wasLabelled) {
      console.log("[ghl.outbound] dedup skip — payload carries our mirror label", {
        sid: lead.manychatSubId,
        preview: text.slice(0, 60),
      });
      return NextResponse.json({
        ok: true,
        skipped: "dedup_mirror_label",
        lead_sid: lead.manychatSubId,
      });
    }
  }

  // Layer 2 (fallback for text-only sends if Layer 1 misses): match recent
  // outbound row text in the messages table.
  if (text) {
    const recent = await db
      .select({ id: messages.id, waMessageId: messages.waMessageId })
      .from(messages)
      .where(
        and(
          eq(messages.manychatSubId, lead.manychatSubId),
          eq(messages.direction, "out"),
          eq(messages.text, stripMirrorLabel(text).body),
          gt(messages.receivedAt, sql`now() - interval '60 seconds'`)
        )
      )
      .orderBy(desc(messages.receivedAt))
      .limit(1);
    if (recent.length > 0) {
      console.log("[ghl.outbound] dedup skip — recent text match", {
        sid: lead.manychatSubId,
        wa_message_id: recent[0].waMessageId,
      });
      return NextResponse.json({
        ok: true,
        skipped: "dedup_text",
        wa_message_id: recent[0].waMessageId,
        lead_sid: lead.manychatSubId,
      });
    }
  }

  try {
    const result = await sendBridgeMessage(
      recipient,
      text ?? "",
      mediaUrl ?? undefined,
      "eli",
      undefined,
      undefined,
      undefined,
      { skipGhlMirror: true }
    );
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

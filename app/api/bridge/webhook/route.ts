/**
 * Bridge webhook receiver. The bridge POSTs signed envelopes here when a
 * message arrives, a send completes, or tenant state changes.
 *
 * Envelope:
 *   { id, type, tenant, occurred_at, api_version, data }
 *
 * Verification:
 *   X-Bridge-Signature: t=<unix>,v1=<hex>
 *   v1 = HMAC-SHA256(BRIDGE_WEBHOOK_SECRET, t + "." + rawBody)
 *   Reject if |now - t| > 5 minutes.
 *
 * Handles:
 *   - message.received → upsert lead (jid), insert message, enqueue analysis.
 *   - message.sent     → insert outbound message (best-effort).
 *   - message.delivered/read/failed → audit-only (logged in bridge_events).
 *   - tenant.paired / tenant.connection_changed → audit-only.
 *
 * Every event lands in bridge_events keyed by evt_id (unique). Duplicate
 * retries are skipped.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { analysisQueue, bridgeEvents, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import {
  insertBridgeMessage,
  upsertLeadFromBridgeEvent,
} from "@/lib/bridge/client";
import { BRIDGE_WEBHOOK_SECRET } from "@/lib/bridge/config";
import { handleInbound } from "@/lib/autoresponder/questionnaire";
import { isStopWord, eliEscalationTemplate } from "@/lib/messaging/templates";
import { sendEliDM } from "@/lib/notify/eli";

export const runtime = "nodejs";
export const maxDuration = 15;

const REPLAY_WINDOW_SECONDS = 300;

interface BridgeEnvelope {
  id: string;
  type: string;
  tenant?: string;
  occurred_at: string;
  api_version?: string;
  data?: Record<string, unknown> | null;
}

function parseSignatureHeader(h: string | null): { t: number; v1: string } | null {
  if (!h) return null;
  const parts = h.split(",").map((p) => p.trim());
  let t: number | null = null;
  let v1: string | null = null;
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t") t = Number(v);
    else if (k === "v1") v1 = v;
  }
  if (!t || !v1) return null;
  if (!Number.isFinite(t)) return null;
  return { t, v1 };
}

function verifySignature(secret: string, t: number, rawBody: string, v1: string): boolean {
  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function pickStr(o: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function handleMessageReceived(evt: BridgeEnvelope): Promise<void> {
  const d = evt.data ?? {};
  const jid = pickStr(d, "chat_jid", "chatJid", "jid");
  if (!jid) return;
  // Ignore WhatsApp Statuses (stories) and groups — we only care about
  // 1:1 chats. Group JIDs end @g.us; Status broadcasts use @broadcast.
  if (jid.endsWith("@broadcast") || jid.endsWith("@g.us")) return;
  // Bridge sends our own outbound as message.received with is_from_me=true
  // on some configs — skip those, they are echoes.
  if ((d as any)?.is_from_me === true) return;
  const waMessageId =
    pickStr(d, "wa_message_id", "id", "messageId") ?? `bridge:${evt.id}`;
  const text = pickStr(d, "text", "content", "body");
  const phone = pickStr(d, "phone");
  const name = pickStr(d, "name", "push_name", "pushName");

  await upsertLeadFromBridgeEvent({
    jid,
    name: name ?? undefined,
    phone: phone ?? undefined,
    source: "bridge_webhook",
  });

  await insertBridgeMessage({
    jid,
    direction: "in",
    text,
    waMessageId,
    payload: d,
    receivedAt: new Date(evt.occurred_at),
  });

  // Stop-word check — escalate Eli, pause bot, do not autoresponder.
  if (isStopWord(text)) {
    try {
      const [row] = await db
        .select({
          name: leads.name,
          phone: leads.phoneE164,
          stage: leads.pipelineStage,
        })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`)
        .limit(1);
      await db
        .update(leads)
        .set({
          botPaused: true,
          pipelineFlag: "NEEDS_ELI",
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`);
      await sendEliDM(
        eliEscalationTemplate({
          name: row?.name ?? null,
          phone: row?.phone ?? null,
          stage: row?.stage ?? null,
          reason: "stop_word",
        })
      );
      console.log("[bridge.webhook] stop-word escalation", jid);
    } catch (e) {
      console.error("[bridge.webhook] stop-word handler error", jid, e);
    }
    return;
  }

  // Customer re-engaged — reset follow-up counter and auto-resume bot
  // (the bot was probably paused after a prior 3-strike escalation; this
  // gives Eli back an active loop until the customer goes cold again).
  try {
    await db
      .update(leads)
      .set({
        followUpCount: 0,
        botPaused: false,
        pipelineFlag: null,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`);
  } catch (e) {
    console.error("[bridge.webhook] counter reset error", jid, e);
  }

  // Auto-responder — only acts on NULL/NEW leads. Mid-pipeline
  // leads short-circuit to `no_op` so Eli keeps full control of replies.
  try {
    const r = await handleInbound({ sid: jid, text });
    console.log("[bridge.webhook] autoresponder", jid, r);
  } catch (e) {
    console.error("[bridge.webhook] autoresponder error", jid, e);
  }

  const open = await db
    .select({ status: analysisQueue.status })
    .from(analysisQueue)
    .where(eq(analysisQueue.manychatSubId, jid));
  const hasOpen = open.some(
    (r) => r.status === "pending" || r.status === "analyzing"
  );
  if (!hasOpen) {
    await db.insert(analysisQueue).values({
      manychatSubId: jid,
      reason: "new_message",
    });
  }
}

async function handleMessageSent(evt: BridgeEnvelope): Promise<void> {
  const d = evt.data ?? {};
  const jid = pickStr(d, "chat_jid", "chatJid", "jid", "recipient");
  if (!jid) return;
  const waMessageId =
    pickStr(d, "wa_message_id", "id", "messageId") ?? `bridge:${evt.id}`;
  const text = pickStr(d, "text", "content", "body");
  await insertBridgeMessage({
    jid,
    direction: "out",
    text,
    waMessageId,
    payload: d,
    receivedAt: new Date(evt.occurred_at),
  });
}

export async function POST(req: NextRequest) {
  // BRIDGE_WEBHOOK_SECRET is BOM-stripped in lib/bridge/config.ts.
  const secret = BRIDGE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "BRIDGE_WEBHOOK_SECRET not configured" },
      { status: 503 }
    );
  }

  const rawBody = await req.text();
  const sig = parseSignatureHeader(req.headers.get("x-bridge-signature"));
  if (!sig) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - sig.t) > REPLAY_WINDOW_SECONDS) {
    return NextResponse.json({ error: "stale signature" }, { status: 401 });
  }

  if (!verifySignature(secret, sig.t, rawBody, sig.v1)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let envelope: BridgeEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!envelope?.id || !envelope.type || !envelope.occurred_at) {
    return NextResponse.json({ error: "malformed envelope" }, { status: 400 });
  }

  try {
    await db.insert(bridgeEvents).values({
      evtId: envelope.id,
      type: envelope.type,
      tenant: envelope.tenant ?? null,
      occurredAt: new Date(envelope.occurred_at),
      payload: envelope as any,
    });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("duplicate") || e?.code === "23505") {
      return NextResponse.json({ ok: true, dedup: true });
    }
    throw e;
  }

  try {
    switch (envelope.type) {
      case "message.received":
        await handleMessageReceived(envelope);
        break;
      case "message.sent":
        await handleMessageSent(envelope);
        break;
      default:
        break;
    }
  } catch (e) {
    console.error("[bridge.webhook] handler error", envelope.type, e);
    return NextResponse.json({ ok: true, handler_error: String(e) });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "bridge webhook receiver",
    configured: Boolean(process.env.BRIDGE_WEBHOOK_SECRET),
  });
}

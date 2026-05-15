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
 *   - message.received → upsert lead, log message, route to autoresponder.
 *   - message.sent     → log outbound message (best-effort).
 *   - message.delivered/read/failed → audit-only (bridge_events).
 *
 * Routing in handleMessageReceived (in priority order):
 *   1. Skip group / status / our-own echoes.
 *   2. Stop-word in text → escalate Eli + pause bot, do nothing else.
 *   3. Reset follow_up_count + last_follow_up_at + un-pause + clear flag
 *      (customer re-engagement = fresh budget).
 *   4. Route by current pipeline_stage:
 *        NULL/NEW          → questionnaire autoresponder
 *        AWAITING_DECISION → LLM intent classifier (decision sub-flow)
 *        AWAITING_LOGO     → media detection + reask loop
 *        QUOTED / NEGOTIATING / WAITING_CALL → LLM intent classifier
 *        WAITING_FACTORY / IN_PROGRESS / WON / DROPPED → no auto-action
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { bridgeEvents, leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import {
  insertBridgeMessage,
  upsertLeadFromBridgeEvent,
} from "@/lib/bridge/client";
import { BRIDGE_WEBHOOK_SECRET } from "@/lib/bridge/config";
import { handleInbound } from "@/lib/autoresponder/questionnaire";
import { handleDecisionInbound } from "@/lib/autoresponder/decision";
import {
  isStopWord,
  eliEscalationTemplate,
  STOP_WORD_REPLY,
} from "@/lib/messaging/templates";
import { sendEliDM } from "@/lib/notify/eli";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { isTestJid } from "@/lib/config/test-jids";

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

function hasMedia(d: any): boolean {
  if (!d) return false;
  const mediaStr = pickStr(d, "media_path", "media_url", "attachment_url", "image_url");
  if (mediaStr) return true;
  const type = typeof d.type === "string" ? d.type.toLowerCase() : "";
  if (type && type !== "text" && type !== "chat" && type !== "message") return true;
  if (d.media || d.attachment || d.image) return true;
  return false;
}

async function getLeadStage(jid: string): Promise<string | null> {
  const [row] = await db
    .select({ stage: leads.pipelineStage })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`)
    .limit(1);
  return row?.stage ?? null;
}

async function handleMessageReceived(evt: BridgeEnvelope): Promise<void> {
  const d = evt.data ?? {};
  const jid = pickStr(d, "chat_jid", "chatJid", "jid");
  if (!jid) return;
  if (jid.endsWith("@broadcast") || jid.endsWith("@g.us")) return;
  if ((d as any)?.is_from_me === true) return;

  const waMessageId =
    pickStr(d, "wa_message_id", "id", "messageId") ?? `bridge:${evt.id}`;
  const text = pickStr(d, "text", "content", "body");
  // When the user taps a WhatsApp interactive button, some bridge variants
  // surface the original button `id` (e.g. "s1") alongside the visible title
  // text. Prefer it for routing so matchAnswer hits the exact option value
  // instead of fuzzy-matching the localized label.
  const buttonReplyId = pickStr(
    d,
    "selected_button_id",
    "button_reply_id",
    "interactive_reply_id"
  );
  const textForRouting = buttonReplyId ?? text;
  const phone = pickStr(d, "phone");
  const name = pickStr(d, "name", "push_name", "pushName");
  const mediaPresent = hasMedia(d);

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
    sender: "lead",
  });

  // 1. Stop-word check. Send one polite "ok, I won't bother you" reply, then
  // pause the bot so the cron leaves the lead alone. Eli still gets the DM
  // so a human can follow up if needed.
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
      try {
        await sendBridgeMessage(jid, STOP_WORD_REPLY);
      } catch (sendErr) {
        // Best-effort — even if the reply fails the bot is now paused.
        console.error("[bridge.webhook] stop-word reply failed", jid, sendErr);
      }
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

  // 2. Re-engagement: reset cadence + un-pause. The new lastFollowUpAt
  //    ensures the follow-up cron waits a fresh cadence window from THIS
  //    inbound rather than from our last outbound (would otherwise look
  //    like we ignored the customer's reply).
  try {
    await db
      .update(leads)
      .set({
        followUpCount: 0,
        lastFollowUpAt: new Date(),
        botPaused: false,
        pipelineFlag: null,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`);
  } catch (e) {
    console.error("[bridge.webhook] counter reset error", jid, e);
  }

  // 2.5 Test-JID auto-reset. Configured numbers always re-enter Stage 1
  // questionnaire so Eli can probe the bot end-to-end from his own phone
  // without manually wiping state in the DB between runs.
  if (isTestJid(jid)) {
    try {
      await db
        .update(leads)
        .set({
          pipelineStage: null,
          qState: null,
          botSummary: null,
          nextAction: null,
          pipelineFlag: null,
          quoteTotal: null,
          quoteAlt: null,
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`);
      console.log("[bridge.webhook] test-jid reset", jid);
    } catch (e) {
      console.error("[bridge.webhook] test-jid reset error", jid, e);
    }
  }

  // 3. Stage-based routing.
  const stage = ((await getLeadStage(jid)) || "").toUpperCase();

  try {
    if (!stage || stage === "NEW") {
      const r = await handleInbound({ sid: jid, text: textForRouting });
      console.log("[bridge.webhook] questionnaire", jid, r);
      return;
    }
    if (
      stage === "AWAITING_DECISION" ||
      stage === "AWAITING_LOGO" ||
      stage === "AWAITING_FINAL"
    ) {
      const r = await handleDecisionInbound({ sid: jid, text: textForRouting, hasMedia: mediaPresent });
      console.log("[bridge.webhook] decision", jid, r);
      return;
    }
    if (stage === "QUOTED" || stage === "NEGOTIATING" || stage === "WAITING_CALL") {
      // Eli manually moved the lead here. Treat inbound as a decision-style
      // signal so we can route via the same LLM intent classifier.
      const r = await handleDecisionInbound({ sid: jid, text: textForRouting, hasMedia: mediaPresent });
      console.log("[bridge.webhook] decision(manual-stage)", jid, stage, r);
      return;
    }
    // WAITING_FACTORY, IN_PROGRESS, WON, DROPPED — bot stays silent. Eli reads.
    console.log("[bridge.webhook] no_op for stage", jid, stage);
  } catch (e) {
    console.error("[bridge.webhook] routing error", jid, e);
  }
}

async function handleMessageSent(evt: BridgeEnvelope): Promise<void> {
  const d = evt.data ?? {};
  const jid = pickStr(d, "chat_jid", "chatJid", "jid", "recipient");
  if (!jid) return;
  const waMessageId =
    pickStr(d, "wa_message_id", "id", "messageId") ?? `bridge:${evt.id}`;
  const text = pickStr(d, "text", "content", "body");
  // Sender attribution heuristic: if our own code initiated the send it has
  // already pre-inserted a row with sender='bot' or 'eli' (approveDraft,
  // sendManualReply, autoresponder paths). insertBridgeMessage dedupes by
  // waMessageId, so reaching this insert path means the message came from a
  // surface we did not originate — i.e. Eli replying directly in the WA
  // Business app on the bonded phone. Default to 'eli' for those.
  await insertBridgeMessage({
    jid,
    direction: "out",
    text,
    waMessageId,
    payload: d,
    receivedAt: new Date(evt.occurred_at),
    sender: "eli",
  });
}

export async function POST(req: NextRequest) {
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

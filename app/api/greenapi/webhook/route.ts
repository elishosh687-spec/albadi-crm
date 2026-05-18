/**
 * Green API webhook receiver. Green POSTs here when a message arrives, a
 * send completes, or instance state changes.
 *
 * Payload (incoming text):
 *   {
 *     "typeWebhook": "incomingMessageReceived",
 *     "instanceData": { idInstance, wid, typeInstance },
 *     "timestamp": <unix>,
 *     "idMessage": "BAE5...",
 *     "senderData": { chatId: "972...@c.us", sender, senderName, chatName },
 *     "messageData": {
 *       "typeMessage": "textMessage",
 *       "textMessageData": { "textMessage": "Hi" }
 *     }
 *   }
 *
 * Payload (poll vote):
 *   messageData.typeMessage = "pollUpdateMessage"
 *   messageData.pollMessageData = {
 *     name, options, multipleAnswers,
 *     votes: [{ optionName, optionVoters: [chatId, ...] }]
 *   }
 *
 * Auth: Green API can send a Bearer token in the Authorization header if
 * configured in the instance console (recommended). We accept any of:
 *   - Authorization: Bearer <GREEN_WEBHOOK_TOKEN>   (if env set)
 *   - Authorization: Bearer <GREEN_API_API_TOKEN_INSTANCE>   (fallback)
 *   - query param `secret=<token>` matching either of the above.
 *
 * Inbound routing: stop-word → pause + Eli DM. Otherwise → questionnaire /
 * decision handler by current pipeline_stage. Supervisor pipeline is NOT
 * re-run here for the v1 cutover — the bridge webhook still owns that path
 * for as long as anything routes through it. We can lift the supervisor
 * into a shared module later.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bridgeEvents, leads, messages as messagesTable } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { handleInbound } from "@/lib/autoresponder/questionnaire";
import { handleDecisionInbound } from "@/lib/autoresponder/decision";
import {
  isStopWord,
  eliEscalationTemplate,
  STOP_WORD_REPLY,
} from "@/lib/messaging/templates";
import { sendEliDM } from "@/lib/notify/eli";
import { sendBridgeMessage } from "@/lib/bridge/client";

export const runtime = "nodejs";
export const maxDuration = 15;

const CHAT_SUFFIX = "@c.us";

interface GreenWebhook {
  typeWebhook: string;
  instanceData?: { idInstance?: number; wid?: string };
  timestamp?: number;
  idMessage?: string;
  senderData?: {
    chatId?: string;
    sender?: string;
    senderName?: string;
    senderContactName?: string;
    chatName?: string;
  };
  messageData?: {
    typeMessage?: string;
    textMessageData?: { textMessage?: string };
    extendedTextMessageData?: { text?: string; description?: string };
    fileMessageData?: {
      downloadUrl?: string;
      caption?: string;
      fileName?: string;
      mimeType?: string;
    };
    pollMessageData?: {
      name?: string;
      options?: Array<{ optionName: string }>;
      multipleAnswers?: boolean;
      votes?: Array<{ optionName: string; optionVoters?: string[] }>;
    };
    locationMessageData?: unknown;
    contactMessageData?: unknown;
  };
  // outgoingMessageStatus payload uses different fields
  chatId?: string;
  status?: string;
  statusType?: string;
  // stateInstanceChanged
  stateInstance?: string;
}

function chatIdToPhone(chatId: string | undefined | null): string | null {
  if (!chatId) return null;
  if (!chatId.endsWith(CHAT_SUFFIX)) return null;
  return chatId.slice(0, -CHAT_SUFFIX.length);
}

function authOk(req: NextRequest): boolean {
  const webhookToken = (process.env.GREEN_WEBHOOK_TOKEN ?? "").trim();
  const instanceToken = (process.env.GREEN_API_API_TOKEN_INSTANCE ?? "").trim();
  const hdr = req.headers.get("authorization") ?? "";
  const qToken = req.nextUrl.searchParams.get("secret") ?? "";
  if (webhookToken) {
    if (hdr === `Bearer ${webhookToken}`) return true;
    if (qToken === webhookToken) return true;
  }
  if (instanceToken) {
    if (hdr === `Bearer ${instanceToken}`) return true;
    if (qToken === instanceToken) return true;
  }
  return false;
}

async function auditLog(evtId: string, type: string, payload: unknown): Promise<void> {
  try {
    await db
      .insert(bridgeEvents)
      .values({
        evtId,
        type: `green.${type}`,
        tenant: "albadi-green",
        occurredAt: new Date(),
        payload: payload as any,
      })
      .onConflictDoNothing();
  } catch (e) {
    console.warn("[green.webhook] audit insert failed", e);
  }
}

function extractInboundText(msg: GreenWebhook["messageData"]): string | null {
  if (!msg) return null;
  const t = msg.typeMessage;
  if (t === "textMessage") return msg.textMessageData?.textMessage ?? null;
  if (t === "extendedTextMessage") {
    return (
      msg.extendedTextMessageData?.text ??
      msg.extendedTextMessageData?.description ??
      null
    );
  }
  if (t === "imageMessage" || t === "videoMessage" || t === "documentMessage") {
    return msg.fileMessageData?.caption ?? `[${t}]`;
  }
  if (t === "audioMessage") return "[audio]";
  return null;
}

/**
 * For a pollUpdateMessage, figure out which option THIS customer voted for.
 * We match by chatId presence in optionVoters[].
 */
function extractVotedOption(
  msg: GreenWebhook["messageData"],
  voterChatId: string
): string | null {
  const votes = msg?.pollMessageData?.votes ?? [];
  for (const v of votes) {
    if (Array.isArray(v.optionVoters) && v.optionVoters.includes(voterChatId)) {
      return v.optionName;
    }
  }
  return null;
}

async function upsertLeadFromGreen(input: {
  chatId: string;
  phone: string;
  name?: string;
}): Promise<void> {
  await db
    .insert(leads)
    .values({
      manychatSubId: input.chatId,
      waJid: input.chatId,
      phoneE164: input.phone,
      name: input.name ?? null,
      source: "greenapi_webhook",
      active: true,
      pipelineStage: "NEW",
    })
    .onConflictDoUpdate({
      target: leads.manychatSubId,
      set: {
        name: sql`COALESCE(${leads.name}, ${input.name ?? null})`,
        phoneE164: sql`COALESCE(${leads.phoneE164}, ${input.phone})`,
        waJid: sql`COALESCE(${leads.waJid}, ${input.chatId})`,
        pipelineStage: sql`COALESCE(${leads.pipelineStage}, 'NEW')`,
        updatedAt: new Date(),
      },
    });
}

async function insertGreenMessage(input: {
  chatId: string;
  direction: "in" | "out";
  text: string | null;
  waMessageId: string;
  sender: "lead" | "bot" | "eli";
  payload: Record<string, unknown>;
}): Promise<{ id: number } | null> {
  const existing = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(eq(messagesTable.waMessageId, input.waMessageId))
    .limit(1);
  if (existing[0]) {
    if (input.text) {
      await db
        .update(messagesTable)
        .set({
          text: sql`COALESCE(${messagesTable.text}, ${input.text})`,
          sender: sql`COALESCE(${messagesTable.sender}, ${input.sender})`,
        })
        .where(eq(messagesTable.id, existing[0].id));
    }
    return existing[0];
  }
  const [row] = await db
    .insert(messagesTable)
    .values({
      manychatSubId: input.chatId,
      direction: input.direction,
      text: input.text,
      waMessageId: input.waMessageId,
      sender: input.sender,
      payload: input.payload as any,
    })
    .returning({ id: messagesTable.id });
  return row;
}

async function handleIncoming(evt: GreenWebhook): Promise<void> {
  const sender = evt.senderData ?? {};
  const chatId = sender.chatId;
  if (!chatId) return;
  if (chatId.endsWith("@g.us") || chatId.startsWith("status@")) return;

  const phone = chatIdToPhone(chatId);
  if (!phone) return;
  const senderName =
    sender.senderContactName || sender.senderName || sender.chatName || undefined;
  await upsertLeadFromGreen({ chatId, phone, name: senderName });

  const msg = evt.messageData;
  const typeMessage = msg?.typeMessage;
  const waMessageId = evt.idMessage ?? `green:${Date.now()}`;

  let textForRouting: string | null = null;
  let textToStore: string | null = null;
  let hasMedia = false;

  if (typeMessage === "pollUpdateMessage") {
    const voted = extractVotedOption(msg, chatId);
    textForRouting = voted;
    textToStore = voted ?? "[poll vote]";
  } else if (
    typeMessage === "imageMessage" ||
    typeMessage === "videoMessage" ||
    typeMessage === "documentMessage" ||
    typeMessage === "audioMessage"
  ) {
    hasMedia = true;
    const t = extractInboundText(msg);
    textForRouting = t;
    textToStore = t;
  } else {
    const t = extractInboundText(msg);
    textForRouting = t;
    textToStore = t;
  }

  await insertGreenMessage({
    chatId,
    direction: "in",
    text: textToStore,
    waMessageId,
    sender: "lead",
    payload: evt as unknown as Record<string, unknown>,
  });

  // Stop-word check.
  if (textForRouting && isStopWord(textForRouting)) {
    try {
      await db
        .update(leads)
        .set({
          botPaused: true,
          pipelineFlag: "NEEDS_ELI",
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${chatId.trim()}`);
      try {
        await sendBridgeMessage(chatId, STOP_WORD_REPLY);
      } catch (e) {
        console.error("[green.webhook] stop-word reply failed", e);
      }
      const [snap] = await db
        .select({
          name: leads.name,
          phone: leads.phoneE164,
          stage: leads.pipelineStage,
        })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${chatId.trim()}`)
        .limit(1);
      await sendEliDM(
        eliEscalationTemplate({
          name: snap?.name ?? null,
          phone: snap?.phone ?? null,
          reason: "stop_word",
          stage: snap?.stage ?? null,
        })
      );
    } catch (e) {
      console.error("[green.webhook] stop-word path failed", e);
    }
    return;
  }

  // Auto-unpause + reset follow-up budget on any non-stopword inbound.
  await db
    .update(leads)
    .set({
      botPaused: false,
      followUpCount: 0,
      lastFollowUpAt: null,
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${chatId.trim()}`);

  // Load lead snapshot for routing.
  const [snap] = await db
    .select({ stage: leads.pipelineStage })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${chatId.trim()}`)
    .limit(1);

  const stage = (snap?.stage ?? "NEW").toUpperCase();

  try {
    if (!stage || stage === "NEW" || stage === "AWAITING_ESTIMATE") {
      await handleInbound({ sid: chatId, text: textForRouting ?? "" });
    } else if (stage === "AWAITING_LOGO" || stage === "AWAITING_FINAL") {
      await handleDecisionInbound({
        sid: chatId,
        text: textForRouting,
        hasMedia,
      });
    }
    // WAITING_FACTORY / WON / DROPPED → no-op
  } catch (e) {
    console.error("[green.webhook] handler failed", e);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: GreenWebhook;
  try {
    body = (await req.json()) as GreenWebhook;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const evtId =
    body.idMessage ??
    `${body.typeWebhook}:${body.timestamp ?? Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  await auditLog(evtId, body.typeWebhook ?? "unknown", body);

  try {
    switch (body.typeWebhook) {
      case "incomingMessageReceived":
        await handleIncoming(body);
        break;
      default:
        // Audit-only: outgoingMessageStatus / stateInstanceChanged / etc.
        break;
    }
  } catch (e) {
    console.error("[green.webhook] handler error", e);
  }

  return NextResponse.json({ ok: true });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, info: "Green API webhook endpoint" });
}

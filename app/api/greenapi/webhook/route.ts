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
import { dispatchSupervisor } from "@/lib/supervisor/server/dispatch";
import { refreshNextAction } from "@/lib/ghl/next-action";
import {
  forwardMessage as ghlForwardMessage,
  syncLeadToGHL,
} from "@/integrations/ghl/sync";

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

/**
 * Resolve the canonical lead sid for this Green chat. Order:
 *   1. Lead already keyed on chatId (e.g. created by a prior Green inbound) →
 *      use that sid.
 *   2. Lead keyed on phone_e164 (e.g. created by /api/leads/facebook-import
 *      under the @s.whatsapp.net JID format) → use that sid and update its
 *      waJid to the Green chatId so future lookups by chatId hit it too.
 *   3. No lead exists → insert a new row keyed on chatId.
 *
 * Returns the canonical sid the rest of the webhook should use for messages,
 * qState reads, etc.
 */
async function upsertLeadFromGreen(input: {
  chatId: string;
  phone: string;
  name?: string;
}): Promise<string> {
  // 1. Exact chatId match.
  const byChat = await db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${input.chatId.trim()}`)
    .limit(1);
  if (byChat[0]) {
    await db
      .update(leads)
      .set({
        name: sql`COALESCE(${leads.name}, ${input.name ?? null})`,
        waJid: sql`COALESCE(${leads.waJid}, ${input.chatId})`,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${byChat[0].sid.trim()}`);
    return byChat[0].sid;
  }

  // 2. Match by phone (handles leads inserted via facebook-import under
  //    `<phone>@s.whatsapp.net`).
  const byPhone = await db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(eq(leads.phoneE164, input.phone))
    .limit(1);
  if (byPhone[0]) {
    await db
      .update(leads)
      .set({
        waJid: input.chatId,
        name: sql`COALESCE(${leads.name}, ${input.name ?? null})`,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${byPhone[0].sid.trim()}`);
    return byPhone[0].sid;
  }

  // 3. New lead.
  await db.insert(leads).values({
    manychatSubId: input.chatId,
    waJid: input.chatId,
    phoneE164: input.phone,
    name: input.name ?? null,
    source: "greenapi_webhook",
    active: true,
    // pipeline_stage = NULL while the questionnaire runs (pre-quote).
    pipelineStage: null,
  });
  return input.chatId;
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
  // canonicalSid is the lead row's manychat_sub_id — may equal chatId for
  // green-native leads or differ (e.g. `<phone>@s.whatsapp.net`) for leads
  // first created via facebook-import. Use it for every DB op below so we
  // don't fork into two rows per customer.
  const canonicalSid = await upsertLeadFromGreen({
    chatId,
    phone,
    name: senderName,
  });

  const msg = evt.messageData;
  const typeMessage = msg?.typeMessage;
  const waMessageId = evt.idMessage ?? `green:${Date.now()}`;

  let textForRouting: string | null = null;
  let textToStore: string | null = null;
  let hasMedia = false;
  let mediaUrl: string | null = null;
  let mediaFilename: string | null = null;
  let mediaMimeType: string | null = null;

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
    mediaUrl = msg?.fileMessageData?.downloadUrl ?? null;
    mediaFilename = msg?.fileMessageData?.fileName ?? null;
    mediaMimeType = msg?.fileMessageData?.mimeType ?? null;
    const t = extractInboundText(msg);
    textForRouting = t;
    textToStore = t;
  } else {
    const t = extractInboundText(msg);
    textForRouting = t;
    textToStore = t;
  }

  const insertedMessage = await insertGreenMessage({
    chatId: canonicalSid,
    direction: "in",
    text: textToStore,
    waMessageId,
    sender: "lead",
    payload: evt as unknown as Record<string, unknown>,
  });
  const inboundMessageId = insertedMessage?.id ?? null;

  // Mirror to GHL Inbox (Phase 1F). Deferred via Next 16 `after()` so we
  // don't block the inbound handler — the lambda stays alive past the HTTP
  // response just long enough to finish the mirror, while the customer's
  // reply pipeline (supervisor / handleInbound / outbound send) runs
  // immediately. Failures stay logged in `bridge_events` via auditMirror.
  const { after } = await import("next/server");
  after(() =>
    ghlForwardMessage({
      sid: canonicalSid,
      direction: "in",
      sender: "lead",
      text: textToStore,
      occurredAt: new Date(),
      mediaUrl,
      mediaFilename,
      mediaMimeType,
    }).catch((e) => {
      console.warn("[greenapi.webhook] ghl forward (in) failed", e);
    })
  );
  after(() =>
    syncLeadToGHL(canonicalSid).catch((e) => {
      console.warn("[greenapi.webhook] syncLeadToGHL failed", e);
    })
  );

  // Skip routing for pollUpdateMessage events that arrive WITHOUT a vote
  // (e.g. when the poll is opened on the customer side but not yet voted).
  // Otherwise we feed empty text into handleInbound and trigger the cold-
  // start path (re-sends OPENING + first question).
  if (typeMessage === "pollUpdateMessage" && !textForRouting) {
    return;
  }

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
        .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`);
      try {
        await sendBridgeMessage(canonicalSid, STOP_WORD_REPLY);
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
        .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`)
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
    .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`);

  // Load lead snapshot for routing.
  const [snap] = await db
    .select({ stage: leads.pipelineStage, qState: leads.qState })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`)
    .limit(1);

  const stage = (snap?.stage ?? "").toUpperCase() || null;
  // qState is authoritative when the questionnaire is mid-flight. Without
  // this guard, a "start over" tag (which resets qState to step 1 but leaves
  // pipeline_stage at whatever GHL last pushed back via resync) sends the
  // customer's first poll answer into the decision handler, which then
  // canned-replies / escalates instead of advancing the questionnaire.
  const q = (snap?.qState ?? null) as
    | { step?: number; doneAt?: string | number; bailed?: boolean }
    | null;
  // Step 9 is the confirmation gate (handleConfirmationStep) — still
  // questionnaire-owned. Step 10 is the terminal done state.
  const questionnaireActive =
    !!q && typeof q.step === "number" && q.step <= 9 && !q.doneAt && !q.bailed;

  // Supervisor gate — LLM decides whether to let the bot reply, draft for Eli,
  // escalate, or silence. Mirrors lib/supervisor/server/dispatch logic used
  // by the bridge webhook so both inbound paths share decision tracking +
  // draft queue. Skipped for empty text (media-only) — handler still runs.
  const dispatch = await dispatchSupervisor({
    sid: canonicalSid,
    bridgeJid: canonicalSid,
    inboundMessageId,
    inboundText: textForRouting ?? "",
    stage,
    mediaPresent: hasMedia,
    botPaused: false, // already auto-unpaused above
    source: "green",
  });

  if (!dispatch.shouldRunLegacy) {
    return;
  }

  try {
    if (questionnaireActive || !stage) {
      // Pre-quote — questionnaire path. Also forced here when qState is
      // mid-flight even if pipeline_stage is set (re-quote via restart-tag
      // where GHL opp stage hasn't been moved back).
      await handleInbound({ sid: canonicalSid, text: textForRouting ?? "" });
    } else if (
      stage === "INITIAL_QUOTE_SENT" ||
      stage === "FACTORY_CHECK" ||
      stage === "FINAL_QUOTE_SENT" ||
      stage === "AWAITING_FIRST_RESPONSE" ||
      stage === "SHOWED_INTEREST" ||
      stage === "NEGOTIATING"
    ) {
      // Internal subFlow routing (logo vs estimate vs final) lives inside
      // handleDecisionInbound via qState.subFlow.
      await handleDecisionInbound({
        sid: canonicalSid,
        text: textForRouting,
        hasMedia,
      });
    }
    // WON / LOST → no-op
  } catch (e) {
    console.error("[green.webhook] handler failed", e);
  }

  // Recompute next_action after handlers updated state (stage transition,
  // draft queued, factory triggered, etc). Push the fresh value to GHL.
  try {
    const newAction = await refreshNextAction(canonicalSid);
    if (newAction !== null) {
      await syncLeadToGHL(canonicalSid);
    }
  } catch (e) {
    console.warn("[green.webhook] next_action refresh failed", (e as Error).message);
  }
}

/**
 * Manual outbound from the WA Business app — Eli typing on his phone.
 * Persist the row with sender='eli' and mirror to GHL Inbox.
 *
 * outgoingAPIMessageReceived (our own sendGreenMessage outbound) is a
 * separate event type that we do NOT handle here — the sender path
 * already inserts the row + forwards to GHL.
 */
async function handleOutgoingManual(evt: GreenWebhook): Promise<void> {
  const sender = evt.senderData ?? {};
  const chatId = sender.chatId;
  if (!chatId) return;
  if (chatId.endsWith("@g.us") || chatId.startsWith("status@")) return;

  const phone = chatIdToPhone(chatId);
  if (!phone) return;
  const senderName =
    sender.senderContactName || sender.senderName || sender.chatName || undefined;
  const canonicalSid = await upsertLeadFromGreen({
    chatId,
    phone,
    name: senderName,
  });

  const msg = evt.messageData;
  const typeMessage = msg?.typeMessage;
  const waMessageId = evt.idMessage ?? `green:out:${Date.now()}`;

  let textToStore: string | null = null;
  let mediaUrl: string | null = null;
  let mediaFilename: string | null = null;
  let mediaMimeType: string | null = null;

  if (
    typeMessage === "imageMessage" ||
    typeMessage === "videoMessage" ||
    typeMessage === "documentMessage" ||
    typeMessage === "audioMessage"
  ) {
    mediaUrl = msg?.fileMessageData?.downloadUrl ?? null;
    mediaFilename = msg?.fileMessageData?.fileName ?? null;
    mediaMimeType = msg?.fileMessageData?.mimeType ?? null;
    textToStore = msg?.fileMessageData?.caption ?? null;
  } else {
    textToStore = extractInboundText(msg);
  }

  await insertGreenMessage({
    chatId: canonicalSid,
    direction: "out",
    text: textToStore,
    waMessageId,
    sender: "eli",
    payload: evt as unknown as Record<string, unknown>,
  });

  // Deferred via Next 16 `after()` — keeps the lambda alive past the HTTP
  // response so the mirror completes, without making the customer (or here:
  // Eli's own manual send) wait. Auditing remains intact through
  // forwardMessage's internal `auditMirror` calls.
  const { after: afterOut } = await import("next/server");
  afterOut(() =>
    ghlForwardMessage({
      sid: canonicalSid,
      direction: "out",
      sender: "eli",
      text: textToStore,
      occurredAt: new Date(),
      mediaUrl,
      mediaFilename,
      mediaMimeType,
    }).catch((e) => {
      console.warn("[greenapi.webhook] ghl forward (out) failed", e);
    })
  );
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
      case "outgoingMessageReceived":
        // Manual outbound from the WA Business app (Eli typing on phone).
        // outgoingAPIMessageReceived is the same shape but originates from
        // our own sendGreenMessage — already mirrored by the sender; skip
        // here to avoid double rows / double-forwarding.
        await handleOutgoingManual(body);
        break;
      default:
        // Audit-only: outgoingMessageStatus / outgoingAPIMessageReceived /
        // stateInstanceChanged / etc.
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

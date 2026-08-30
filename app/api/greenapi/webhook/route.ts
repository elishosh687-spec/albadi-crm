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
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { handleInbound, type QState } from "@/lib/autoresponder/questionnaire";
import { handleDecisionInbound } from "@/lib/autoresponder/decision";
import { handleCallbackReply } from "@/lib/autoresponder/callback-request";
import {
  isStopWord,
  isHumanHandoffRequest,
  isLeadFormGreeting,
  eliEscalationTemplate,
  STOP_WORD_REPLY,
} from "@/lib/messaging/templates";
import { getBotSettings } from "@/lib/bot-settings/store";
import { pauseFields } from "@/lib/autoresponder/bot-pause";
import { sendEliDM } from "@/lib/notify/eli";
import { findTeamMemberByPhone } from "@/lib/notify/team";
import {
  detectWebsiteOrigin,
  recordWebsiteOrigin,
} from "@/lib/leads/website-origin";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { dispatchSupervisor } from "@/lib/supervisor/server/dispatch";
import { refreshNextAction } from "@/lib/ghl/next-action";
import {
  forwardMessage as ghlForwardMessage,
  syncLeadToGHL,
} from "@/integrations/ghl/sync";

export const runtime = "nodejs";
// 60, not 15. At 15 the setter's LLM reply + the GHL mirror finished at ~15.0s
// and the lambda was killed a hair before returning 200, so Green API retried
// and the customer got the answer again. See the dedupe note in POST.
export const maxDuration = 60;

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

/**
 * Audit the envelope AND claim it.
 *
 * Returns false when this evtId was already stored — i.e. Green API is
 * re-delivering a webhook we have seen. `bridge_events.evt_id` is UNIQUE, so
 * the insert itself is the claim: exactly one caller can win it, even if two
 * retries land on two lambdas at the same moment.
 *
 * This return value is the whole fix for the 2026-08-26 duplicate-reply bug —
 * see the note on the POST handler.
 */
async function auditLog(
  evtId: string,
  type: string,
  payload: unknown,
): Promise<boolean> {
  try {
    const rows = await db
      .insert(bridgeEvents)
      .values({
        evtId,
        type: `green.${type}`,
        tenant: "albadi-green",
        occurredAt: new Date(),
        payload: payload as any,
      })
      .onConflictDoNothing()
      .returning({ id: bridgeEvents.id });
    return rows.length > 0;
  } catch (e) {
    console.warn("[green.webhook] audit insert failed", e);
    // Never let an audit failure swallow a real customer message.
    return true;
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

/**
 * Has this exact poll vote already arrived from this lead moments ago?
 *
 * Scoped to poll votes ON PURPOSE, and the scope is the whole safety argument.
 * Over 60 days of production traffic the identical-inbound-within-90s pairs
 * were: 48 poll votes (the bug — WhatsApp re-delivers a vote update with a
 * fresh message id), 11 voice notes (NOT duplicates — every voice note is
 * stored as the literal text "[audio]", so two different ones look identical),
 * and 3 typed messages (customers genuinely saying "היי" twice). Deduping on
 * text alone would have swallowed those 14 real messages. A poll vote is safe
 * because the options within one questionnaire are always distinct strings, so
 * the same option twice can only be the same answer twice.
 */
const DUPLICATE_INBOUND_WINDOW_SECONDS = 90;

async function isDuplicatePollVote(
  sid: string,
  text: string,
  selfMessageId: number | null
): Promise<boolean> {
  try {
    const conditions = [
      eq(messagesTable.manychatSubId, sid),
      eq(messagesTable.direction, "in"),
      eq(messagesTable.text, text),
      sql`${messagesTable.payload}->'messageData'->>'typeMessage' = 'pollUpdateMessage'`,
      gt(
        messagesTable.receivedAt,
        sql`now() - (${DUPLICATE_INBOUND_WINDOW_SECONDS} || ' seconds')::interval`
      ),
    ];
    if (selfMessageId !== null) conditions.push(ne(messagesTable.id, selfMessageId));
    const prior = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(...conditions))
      .limit(1);
    return prior.length > 0;
  } catch (e) {
    // A failure here must never swallow a customer's message.
    console.error("[greenapi.webhook] duplicate check failed, routing anyway", e);
    return false;
  }
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

  // A colleague wrote in — not a customer. Never make them a lead.
  //
  // Registering someone in `crm.team` used to protect only the OUTBOUND side.
  // When Simon answered a question we had sent him (2026-08-27) this webhook
  // saw an unknown number, created a lead, synced a GHL contact, and the bot
  // opened the Hebrew questionnaire on him — then nudged him again hours later.
  // He replied "can you explain to me in English?" and Eli had to apologise for
  // the bot. Nothing below this line should run for a teammate.
  const teamMember = await findTeamMemberByPhone(chatId);
  if (teamMember) {
    console.log(
      `[green.webhook] inbound from teammate ${teamMember.name} (${chatId}) — no lead, no bot`,
    );
    return;
  }

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

  // Did they arrive by pressing WhatsApp on the website? The prefilled sentence
  // the site puts in the box is the only evidence — same number, same webhook
  // as every other cold inbound. Fills `lead_source` only when it is still
  // empty, and always logs a `source_touches` row. Never throws.
  const websiteOrigin = detectWebsiteOrigin(textToStore);
  if (websiteOrigin) {
    await recordWebsiteOrigin(canonicalSid, websiteOrigin);
  }

  // Duplicate poll-vote guard — the same answer reaching us twice.
  //
  // A WhatsApp poll vote arrives repeatedly with a DIFFERENT message id each
  // time, so the wa_message_id dedupe above can't see it. The first copy
  // advances the questionnaire; the second then lands on the NEXT question,
  // matches nothing, and fires "לא הצלחתי להבין" + a re-ask — so the customer
  // is asked the same thing twice and reads the bot as broken (Eli
  // 2026-08-16: "שולח את הסקר שוב ושוב"). Only ROUTING is skipped: the row is
  // already stored and mirrored, so the record keeps everything.
  if (
    typeMessage === "pollUpdateMessage" &&
    textForRouting?.trim() &&
    (await isDuplicatePollVote(canonicalSid, textForRouting, inboundMessageId))
  ) {
    console.log("[greenapi.webhook] duplicate poll vote — stored but not routed", {
      sid: canonicalSid,
      waMessageId,
      text: textForRouting.slice(0, 60),
    });
    return;
  }

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

  // Meta lead-form greeting — a hello, not an answer.
  //
  // WhatsApp sends it on the customer's behalf a beat AFTER our opening, so
  // the questionnaire treated it as the answer to the question it had just
  // asked, rejected it, and re-asked. It caused 73 of ~200 "לא הצלחתי להבין"
  // messages over 60 days, on Facebook leads specifically — the main lead
  // source. Only skipped once the questionnaire is already running: with no
  // qState this could be the lead's first contact, and swallowing it would
  // mean the bot never opens at all.
  if (textForRouting && isLeadFormGreeting(textForRouting)) {
    // Gated on "have we spoken yet", not on qState.
    //
    // The greeting lands a second or two after our opening, and the
    // questionnaire's first question is written in the same beat — so qState
    // was frequently still null at the moment the greeting was processed, the
    // guard fell through, and the greeting was scored as an answer anyway.
    // That is what happened to שרון יואב on 2026-08-18: opening at 06:33:07,
    // greeting at :08, "לא הצלחתי להבין" at :11, and her questionnaire never
    // moved past question 1 again.
    //
    // An outbound message is the honest test: if we have already said hello,
    // this greeting cannot be the thing that opens the conversation, so it is
    // never an answer either. With no outbound at all it still falls through,
    // so a first-contact lead is never left unopened.
    const [existing] = await db
      .select({ qState: leads.qState })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`)
      .limit(1);
    const [spoken] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(sql`trim(${messagesTable.manychatSubId}) = ${canonicalSid.trim()} AND ${messagesTable.direction} = 'out'`);
    if (existing && (existing.qState || (spoken?.n ?? 0) > 0)) {
      console.log("[greenapi.webhook] lead-form greeting — stored, not treated as an answer", {
        sid: canonicalSid,
      });
      return;
    }
  }

  // "Give me a human" — checked BEFORE the stop word, because some of these
  // phrases contain stop-word substrings ("תפסיק עם הבוט") and the outcomes
  // are opposite: this customer is still buying, they just don't want a bot.
  // Silence the bot, tell Eli, leave the stage exactly where it was.
  if (textForRouting && isHumanHandoffRequest(textForRouting)) {
    try {
      const [snap] = await db
        .select({
          name: leads.name,
          phone: leads.phoneE164,
          stage: leads.pipelineStage,
        })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`)
        .limit(1);
      await db
        .update(leads)
        .set({ ...pauseFields("human_handoff"), pipelineFlag: "NEEDS_ELI" })
        .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`);
      try {
        const settings = await getBotSettings();
        await sendBridgeMessage(canonicalSid, settings.humanHandoffReply);
      } catch (e) {
        console.error("[green.webhook] human-handoff reply failed", e);
      }
      await sendEliDM(
        `🙋 ${snap?.name ?? snap?.phone ?? "ליד"} ביקש לדבר עם בן אדם — הבוט הושתק.\n` +
          `לקוח: "${textForRouting.slice(0, 120)}"\n` +
          `שלב: ${snap?.stage ?? "קליטה"} · הליד פעיל, צריך מענה אנושי.`
      );
      try {
        await syncLeadToGHL(canonicalSid);
      } catch (e) {
        console.warn("[green.webhook] sync after human handoff failed", e);
      }
    } catch (e) {
      console.error("[green.webhook] human-handoff handling failed", e);
    }
    return;
  }

  // Stop-word check. Customer explicitly asked us to stop — move stage to
  // LOST so the GHL pipeline reflects the outcome, pause the bot, and DM
  // Eli. The lossReason field captures the trigger for later analysis.
  if (textForRouting && isStopWord(textForRouting)) {
    try {
      // Snapshot BEFORE updating so the DM shows the stage the customer
      // was sitting at when they opted out (e.g. NO_RESPONSE_REENGAGE),
      // not "LOST" which is the post-update state.
      const [snap] = await db
        .select({
          name: leads.name,
          phone: leads.phoneE164,
          stage: leads.pipelineStage,
        })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`)
        .limit(1);
      await db
        .update(leads)
        .set({
          ...pauseFields("opt_out"),
          pipelineStage: "LOST",
          pipelineFlag: null,
          lossReason: "opt_out",
        })
        .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`);
      try {
        await sendBridgeMessage(canonicalSid, STOP_WORD_REPLY);
      } catch (e) {
        console.error("[green.webhook] stop-word reply failed", e);
      }
      await sendEliDM(
        eliEscalationTemplate({
          name: snap?.name ?? null,
          phone: snap?.phone ?? null,
          reason: "stop_word",
          stage: snap?.stage ?? null,
        })
      );
      // Push LOST + lossReason to GHL so the opp moves in the UI.
      try {
        await syncLeadToGHL(canonicalSid);
      } catch (e) {
        console.warn("[green.webhook] stop-word syncLeadToGHL failed", e);
      }
    } catch (e) {
      console.error("[green.webhook] stop-word path failed", e);
    }
    return;
  }

  // Snapshot pause state BEFORE any update — needed for the sticky-pause
  // short-circuit below and to keep the supervisor honest if it ever runs.
  const [preUpdateSnap] = await db
    .select({ botPaused: leads.botPaused })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`)
    .limit(1);
  const wasBotPaused = preUpdateSnap?.botPaused === true;

  // Reset follow-up cadence on any non-stopword inbound. Sticky pause: do
  // NOT clear botPaused here — once Eli (or any handler) paused the bot, a
  // customer message does not auto-resume. Eli must un-pause via dashboard.
  await db
    .update(leads)
    .set({
      followUpCount: 0,
      lastFollowUpAt: null,
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`);

  if (wasBotPaused) {
    // No supervisor / no reply — inbound is already persisted; the dashboard
    // surfaces it via the messages timeline. Eli toggles pause off when he
    // wants the bot back.
    console.log(`[green.webhook] sticky-pause hit for ${canonicalSid} — no auto-resume, no reply`);
    return;
  }

  // "New conversation" detection — if the customer hasn't pinged in over 7
  // days, treat the next inbound as a fresh start regardless of any prior
  // qState / pipeline_stage. Covers Meta-ad re-leads (same phone clicks a
  // new ad with a different prefilled template) and stale test leads. The
  // NO_RESPONSE_REENGAGE branch below has its own dedicated handler — we
  // skip the restart there so the bot doesn't trample the re-engagement
  // intent classifier.
  const NEW_CONVO_GAP_MS = 7 * 24 * 60 * 60 * 1000;
  const priorInboundRows = await db.execute(sql`
    SELECT received_at FROM messages
    WHERE manychat_sub_id = ${canonicalSid} AND direction = 'in'
    ORDER BY received_at DESC
    OFFSET 1 LIMIT 1
  `);
  const priorInboundAt = (priorInboundRows.rows[0] as { received_at?: Date } | undefined)?.received_at;
  const isNewConversation =
    priorInboundAt &&
    Date.now() - new Date(priorInboundAt).getTime() > NEW_CONVO_GAP_MS;

  // Load lead snapshot for routing.
  const [snap] = await db
    .select({
      stage: leads.pipelineStage,
      qState: leads.qState,
      name: leads.name,
      waJid: leads.waJid,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`)
    .limit(1);

  const stage = (snap?.stage ?? "").toUpperCase() || null;

  // Both revival loops are EXEMPT from the restart.
  //
  // They deliberately message leads who have been silent for weeks, so every
  // reply they earn trips the 7-day gap. Sending "בוא נמלא יחד שאלון קצר" to a
  // customer who just answered "מחר ב-11" throws away the booked call and asks
  // them their quantity again — the questionnaire-repetition complaint, in a
  // different doorway. Keyed on the armed latch as well as the stage, so a lead
  // we asked for a time is protected wherever it currently sits.
  const armedForCallback =
    ((snap?.qState ?? null) as QState | null)?.callbackFlow === "awaiting_reply";
  const skipRestart =
    stage === "NO_RESPONSE_REENGAGE" || stage === "FUTURE_FOLLOW_UP" || armedForCallback;

  if (isNewConversation && !skipRestart) {
    console.log(
      `[green.webhook] new-conversation reset for ${canonicalSid} (gap ${Math.round((Date.now() - new Date(priorInboundAt!).getTime()) / 86_400_000)}d) — restarting questionnaire`
    );
    try {
      const { restartQuestionnaire } = await import("@/lib/autoresponder/questionnaire");
      await restartQuestionnaire(canonicalSid, "שלום 👋 בוא נמלא יחד שאלון קצר כדי שאוכל להכין הצעת מחיר.");
    } catch (e) {
      console.error("[green.webhook] new-conversation restart failed", e);
    }
    return;
  }

  // Re-read the pause state as late as possible: a salesperson (or Eli) may have
  // jumped into THIS chat — outgoingMessageReceived → handleOutgoingManual set
  // botPaused=true — while we were persisting + mirroring this inbound. If so,
  // the human is now driving: stay silent instead of firing one more bot reply
  // on top of them. Closes the race that let the bot "keep talking" after a
  // takeover (Eli 2026-07-26). wasBotPaused (read at the top) only covers a pause
  // that predates this inbound; this catches one that landed mid-processing.
  //
  // Hoisted above the revival branches (2026-08-17): each of them writes state
  // and messages somebody, so "a human already took over" has to win over all
  // of them, not only over the questionnaire path.
  const [latePause] = await db
    .select({ botPaused: leads.botPaused })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()}`)
    .limit(1);
  if (latePause?.botPaused === true) {
    console.log(`[green.webhook] late-pause hit for ${canonicalSid} — human took over mid-inbound, bot stays silent`);
    return;
  }

  // Callback-time reply — when the lead was asked "when's good to talk?",
  // interpret this message first: it may open a salesperson task and confirm
  // the slot to the customer.
  //
  // Hoisted above dispatchSupervisor (2026-08-17). The supervisor can return
  // shouldRunLegacy=false, which would swallow the one reply this whole revival
  // loop exists to capture — a customer answering with a time. This is also the
  // only text→task bridge in the system, so nothing downstream would catch it.
  const fullQ = (snap?.qState ?? null) as QState | null;
  if (fullQ?.callbackFlow === "awaiting_reply") {
    try {
      const handled = await handleCallbackReply({
        sid: canonicalSid,
        text: textForRouting ?? "",
        recipient: (snap?.waJid && snap.waJid.trim()) || canonicalSid,
        name: snap?.name ?? null,
        qState: fullQ,
      });
      if (handled) return;
    } catch (e) {
      console.error("[green.webhook] callback reply handler failed", e);
    }
  }

  // NO_RESPONSE_REENGAGE inbound — classify intent, DM Eli, pause bot,
  // hand off. Eli moves the stage manually. Runs before supervisor so we
  // don't waste an LLM call on the supervisor decision tree for a stage it
  // doesn't know how to route. The auto-unpause above just zeroed
  // followUpCount + lastFollowUpAt — without this handler the next cron
  // tick would treat the customer as freshly stuck and send another
  // re-engagement nudge.
  if (stage === "NO_RESPONSE_REENGAGE" && textForRouting?.trim()) {
    const { handleReengagementInbound } = await import("@/lib/autoresponder/re-engagement");
    await handleReengagementInbound({ sid: canonicalSid, text: textForRouting });
    return;
  }

  // FUTURE_FOLLOW_UP inbound that wasn't a time.
  //
  // Without this the customer gets NOTHING: the routing chain below covers
  // INTAKE / FACTORY_WAIT / CONSIDERATION / DISCAVERY, and a parked lead is in
  // none of them — so a cold lead who finally writes "כמה זה עולה היום?" is met
  // with silence, the worst possible outcome for a revival loop.
  //
  // It does NOT fall through to handleDecisionInbound: that routes on
  // qState.subFlow and assumes post-quote state which 20 of the 45 parked leads
  // don't have. The re-engagement handler is the right shape — classify, pause
  // with the auto-resumable `reengagement_reply`, tell Eli — plus a task, since
  // a cold lead that speaks again is the most valuable thing this loop produces
  // and a DM scrolls away.
  if (stage === "FUTURE_FOLLOW_UP" && textForRouting?.trim()) {
    const { handleReengagementInbound } = await import("@/lib/autoresponder/re-engagement");
    await handleReengagementInbound({
      sid: canonicalSid,
      text: textForRouting,
      stageLabel: "להתקשר בעתיד",
      openTask: true,
    });
    return;
  }

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
    botPaused: false, // not paused (checked immediately above)
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
      stage === "INTAKE" ||
      stage === "FACTORY_WAIT" ||
      stage === "CONSIDERATION" ||
      stage === "DISCAVERY"
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

  // Same rule as the inbound path: Eli typing to a colleague from his phone
  // must not create a lead either.
  const teamMember = await findTeamMemberByPhone(chatId);
  if (teamMember) {
    console.log(
      `[green.webhook] manual outbound to teammate ${teamMember.name} — no lead`,
    );
    return;
  }

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

  // A salesperson answered the customer DIRECTLY on WhatsApp → the human is now
  // driving, so STOP the bot for this lead (sticky pause; the incoming handler
  // never auto-resumes it — Eli un-pauses manually when he wants the bot back).
  // Mirrors the widget path (sendManualReply already pauses). Per Eli 2026-07-22.
  // Gate on the false→true transition so we only push to GHL once, not on every
  // subsequent manual message in the thread.
  try {
    const paused = await db
      .update(leads)
      .set(pauseFields("human_reply"))
      .where(
        sql`trim(${leads.manychatSubId}) = ${canonicalSid.trim()} AND ${leads.botPaused} IS DISTINCT FROM TRUE`
      )
      .returning({ sid: leads.manychatSubId });
    if (paused.length > 0) {
      console.log(
        `[green.webhook] salesperson replied on WhatsApp → bot paused for ${canonicalSid}`
      );
      void syncLeadToGHL(canonicalSid).catch((e) =>
        console.warn("[green.webhook] pause-on-manual syncLeadToGHL failed", e)
      );
    }
  } catch (e) {
    console.warn("[green.webhook] pause-on-manual-reply failed", e);
  }

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
  // ⚠️ Idempotency. Green API retries a webhook it got no 200 for, roughly
  // every 75 seconds. Until 2026-08-26 nothing stopped the retry from being
  // processed again: auditLog swallowed the duplicate with onConflictDoNothing
  // and insertGreenMessage returned the existing row — both correctly refused
  // to write a second row, and both let the handler run on. So one customer
  // message produced a fresh LLM reply per retry. יחיאל בן שושן got the same
  // question three times in three minutes, 74s apart, and the third one opened
  // with "כדי לא לחזור על עצמי". 29 such re-sends reached 9 customers.
  //
  // The trigger was maxDuration=15 on this route: the setter's LLM call plus
  // the GHL mirror finished at ~15.0s, so the lambda was killed just before it
  // could return 200 — work done, no acknowledgement, retry. maxDuration is 60
  // now, and this claim makes a retry harmless even when one does happen.
  //
  // Only true duplicates are dropped. An evtId is Green's own idMessage, unique
  // per message; envelopes without one get a random evtId and so never collide.
  const claimed = await auditLog(evtId, body.typeWebhook ?? "unknown", body);
  if (!claimed) {
    console.warn(
      `[green.webhook] duplicate delivery ignored — evt=${evtId} type=${body.typeWebhook}`,
    );
    return NextResponse.json({ ok: true, deduped: true });
  }

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

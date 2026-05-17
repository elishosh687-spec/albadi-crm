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
 *        AWAITING_ESTIMATE → LLM intent classifier (decision sub-flow)
 *        AWAITING_LOGO     → media detection + reask loop
 *        WAITING_FACTORY / WON / DROPPED → no auto-action
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { bridgeEvents, leads, messages as messagesTable } from "@/drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
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
import { precomputeCandidateAction } from "@/lib/supervisor/candidate";
import { superviseIncomingMessage } from "@/lib/supervisor/supervise";
import { logDecision, attachEliFeedback } from "@/lib/supervisor/log";
import { generateAndQueueDraft } from "@/lib/drafts";

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
  // The bridge currently surfaces inbound media on `url` + `media_type` +
  // `filename`. Older code paths used the older `media_path`/`*_url` aliases,
  // and other webhook providers (legacy ManyChat shim) used `attachment_url`.
  // Check all so a real image/document/audio inbound is never mistaken for text.
  const mediaStr = pickStr(
    d,
    "media_path",
    "media_url",
    "attachment_url",
    "image_url",
    "url"
  );
  if (mediaStr) return true;
  const mediaType =
    typeof d.media_type === "string" ? d.media_type.toLowerCase() : "";
  if (mediaType && mediaType !== "text") return true;
  const filename = typeof d.filename === "string" ? d.filename.trim() : "";
  if (filename) return true;
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
  if ((d as any)?.is_from_me === true) {
    // Echo of a message Eli sent from the WA Business app. Store for CRM
    // display. insertBridgeMessage dedupes by waMessageId so bot messages
    // that were already pre-inserted (sender='bot') are not overwritten.
    const waMessageId =
      pickStr(d, "wa_message_id", "id", "messageId") ?? `bridge:${evt.id}`;
    const text = pickStr(d, "content", "text", "body");
    const inserted = await insertBridgeMessage({
      jid,
      direction: "out",
      text,
      waMessageId,
      payload: d,
      receivedAt: new Date(evt.occurred_at),
      sender: "eli",
    });
    // Bot Supervisor Phase 1: if this is a fresh insert (not dedupe of a
    // bot/eli pre-insert), Eli replied directly from his phone. Attach as
    // feedback to the most-recent decision log row so the supervisor's
    // suggestion (if any) gets a verdict.
    if (inserted && text && text.trim()) {
      await attachEliFeedback({
        manychatSubId: jid,
        eliAction: "direct_whatsapp_reply",
        eliManualReply: text,
      });
    }
    return;
  }

  const waMessageId =
    pickStr(d, "wa_message_id", "id", "messageId") ?? `bridge:${evt.id}`;
  const rawText = pickStr(d, "text", "content", "body");
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

  // Poll vote arrives as message.received with data.media_type="poll_vote"
  // and data.content as a JSON string carrying
  //   { poll_msg_id, selected_indices[], selected_options[], sender_timestamp_ms }
  // We unwrap it into the option label so matchAnswer/handleInbound see a
  // plain text reply like "בינוני" instead of raw JSON.
  let voteOptionText: string | null = null;
  const isPollVote = (d as any)?.media_type === "poll_vote";
  if (isPollVote && rawText) {
    try {
      const parsed = JSON.parse(rawText);
      const sel = Array.isArray(parsed?.selected_options) ? parsed.selected_options : [];
      if (sel.length > 0 && typeof sel[0] === "string") {
        voteOptionText = sel[0];
      }
    } catch (e) {
      console.warn("[bridge.webhook] poll_vote parse failed", waMessageId, e);
    }
  }
  // `text` is what we persist to the messages row. For poll votes we store
  // the human-readable option, not the JSON envelope. `textForRouting` is
  // what the autoresponder sees. Both prefer the vote when present.
  const text = voteOptionText ?? rawText;
  const textForRouting = voteOptionText ?? buttonReplyId ?? rawText;
  const phone = pickStr(d, "phone");
  const name = pickStr(d, "name", "push_name", "pushName");
  // Poll votes carry media_type="poll_vote" which hasMedia() would flag as
  // media — they aren't media, they're textual answers.
  const mediaPresent = isPollVote ? false : hasMedia(d);

  await upsertLeadFromBridgeEvent({
    jid,
    name: name ?? undefined,
    phone: phone ?? undefined,
    source: "bridge_webhook",
  });

  // Capture the inserted message_id for the decision log.
  const inserted = await insertBridgeMessage({
    jid,
    direction: "in",
    text,
    waMessageId,
    payload: d,
    receivedAt: new Date(evt.occurred_at),
    sender: "lead",
  });
  const inboundMessageId: number | null = inserted?.id ?? null;

  // Load lead snapshot BEFORE auto-unpause so we know the original state.
  const [leadSnapshot] = await db
    .select({
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      qState: leads.qState,
      botPaused: leads.botPaused,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`)
    .limit(1);

  const wasBotPaused = leadSnapshot?.botPaused === true;

  // 1. Stop-word check — bypasses supervisor. Send one polite reply, pause,
  // DM Eli. Logged so the row appears in the decision timeline.
  if (isStopWord(text)) {
    try {
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
        console.error("[bridge.webhook] stop-word reply failed", jid, sendErr);
      }
      await sendEliDM(
        eliEscalationTemplate({
          name: leadSnapshot?.name ?? null,
          phone: leadSnapshot?.phone ?? null,
          stage: leadSnapshot?.stage ?? null,
          reason: "stop_word",
        })
      );
      console.log("[bridge.webhook] stop-word escalation", jid);
    } catch (e) {
      console.error("[bridge.webhook] stop-word handler error", jid, e);
    }
    await logDecision({
      manychatSubId: jid,
      messageId: inboundMessageId,
      inboundText: text,
      stageBefore: leadSnapshot?.stage ?? null,
      stageAfter: leadSnapshot?.stage ?? null,
      decidedBy: "code",
      action: "paused",
      replyText: STOP_WORD_REPLY,
      escalationKind: "stop_word",
      metadata: { path: "stop_word_early_exit" },
    });
    return;
  }

  // 2. Re-engagement: reset cadence + un-pause. Log if the bot was actually
  // paused before (so we can audit auto-wakeups).
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

  if (wasBotPaused) {
    await logDecision({
      manychatSubId: jid,
      messageId: inboundMessageId,
      inboundText: text,
      stageBefore: leadSnapshot?.stage ?? null,
      stageAfter: leadSnapshot?.stage ?? null,
      decidedBy: "code",
      action: "unpaused_on_inbound",
      metadata: { reason: "customer re-engaged, bot_paused → false" },
    });
  }

  // 2.5 Test-JID auto-reset (no log row — internal dev path).
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

  // 3. Supervisor-gated routing. Every inbound passes through the LLM
  // supervisor BEFORE any reply is sent. Verdict routing below.
  try {
    await routeThroughSupervisor({
      jid,
      inboundMessageId,
      text,
      textForRouting,
      mediaPresent,
      wasBotPaused,
      leadSnapshot,
    });
  } catch (e) {
    console.error("[bridge.webhook] supervisor routing error", jid, e);
    // Best-effort: log the failure so it's visible in the dashboard.
    await logDecision({
      manychatSubId: jid,
      messageId: inboundMessageId,
      inboundText: text,
      stageBefore: leadSnapshot?.stage ?? null,
      decidedBy: "supervisor_error",
      action: "no_op",
      llmRecommended: "supervisor_error",
      llmReason: `routing exception: ${e instanceof Error ? e.message : String(e)}`,
      metadata: { source: "routeThroughSupervisor catch" },
    });
  }
}

/**
 * Load recent 20 messages for supervisor context.
 */
async function loadRecentForSupervisor(
  sid: string
): Promise<{ direction: "in" | "out"; text: string }[]> {
  const rows = await db
    .select({
      direction: messagesTable.direction,
      text: messagesTable.text,
    })
    .from(messagesTable)
    .where(eq(messagesTable.manychatSubId, sid.trim()))
    .orderBy(desc(messagesTable.receivedAt))
    .limit(20);
  return rows
    .filter((r) => r.text && r.text.trim().length > 0)
    .map((r) => ({ direction: r.direction as "in" | "out", text: r.text! }))
    .reverse();
}

interface SupervisorRouteInput {
  jid: string;
  inboundMessageId: number | null;
  text: string | null;
  textForRouting: string | null;
  mediaPresent: boolean;
  wasBotPaused: boolean;
  leadSnapshot: {
    name: string | null;
    phone: string | null;
    stage: string | null;
    qState: any;
    botPaused: boolean | null;
  } | null;
}

async function routeThroughSupervisor(input: SupervisorRouteInput): Promise<void> {
  const { jid, inboundMessageId, text, textForRouting, mediaPresent, wasBotPaused } = input;

  // Reload stage in case test-JID reset just cleared it.
  const stage = ((await getLeadStage(jid)) || "").toUpperCase() || null;
  const [freshLead] = await db
    .select({
      name: leads.name,
      phone: leads.phoneE164,
      qState: leads.qState,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`)
    .limit(1);

  const inboundText = (text ?? "").trim();
  // Empty-text inbounds (media-only without caption) — let existing handler
  // own that decision; supervisor input would be useless without text.
  // We skip the supervisor and let the legacy handlers do their thing, but
  // still log a row so the timeline shows the event.
  if (!inboundText) {
    if (stage === "AWAITING_LOGO") {
      // Media without caption at AWAITING_LOGO is the happy path (logo received).
      // Run the handler; it will transition stage.
      try {
        const r = await handleDecisionInbound({
          sid: jid,
          text: textForRouting,
          hasMedia: mediaPresent,
        });
        await logDecision({
          manychatSubId: jid,
          messageId: inboundMessageId,
          inboundText: "(media-only)",
          stageBefore: stage,
          decidedBy: "code",
          action: r.action === "escalated" ? "escalated" : "stage_transition",
          metadata: { handler: "handleDecisionInbound", result: r, reason: "media-only at AWAITING_LOGO" },
        });
        return;
      } catch (e) {
        console.error("[supervisor.route] AWAITING_LOGO media handler error", e);
      }
    }
    // Other stages with empty text — let the legacy handler decide (it usually escalates).
    await runLegacyHandlerAndLog({
      jid,
      stage,
      inboundMessageId,
      text: textForRouting,
      mediaPresent,
      inboundLogText: "(empty)",
    });
    return;
  }

  const recent = await loadRecentForSupervisor(jid);

  const candidate = await precomputeCandidateAction({
    stage,
    inboundText,
    hasMedia: mediaPresent,
    qState: freshLead?.qState ?? null,
    recentMessages: recent,
    leadName: freshLead?.name ?? null,
  });

  const verdict = await superviseIncomingMessage({
    sid: jid,
    jid,
    inboundText,
    stage,
    qState: freshLead?.qState ?? null,
    recentMessages: recent,
    leadName: freshLead?.name ?? null,
    phone: freshLead?.phone ?? null,
    botPaused: wasBotPaused,
    candidate,
  });

  // Auto-send lane — overrule the LLM when it conservatively escalated a
  // low-stakes canned-reply intent. Saves Eli a draft approval on no-brainers
  // (samples, delivery time, format, who-we-are, "is it all included").
  // Only fires when candidate predicted a canned_reply with high intent
  // confidence AND supervisor had no risk flags.
  const SAFE_AUTOSEND_INTENTS = new Set([
    "samples_request",
    "question_delivery",
    "question_format",
    "question_company",
    "question_inclusive",
  ]);
  if (
    verdict.recommended === "escalate_to_eli" &&
    !verdict.overrideText &&
    verdict.riskFlags.length === 0 &&
    candidate.kind === "canned_reply" &&
    candidate.intent &&
    SAFE_AUTOSEND_INTENTS.has(candidate.intent) &&
    (candidate.intentConfidence ?? 0) >= 0.85 &&
    (verdict.confidence ?? 0) < 0.6 // only override LOW-confidence escalations
  ) {
    console.log(
      "[supervisor.route] auto-send override:",
      jid,
      candidate.intent,
      `cand.conf=${candidate.intentConfidence}`,
      `sup.conf=${verdict.confidence}`
    );
    verdict.recommended = "approve_code";
    verdict.reason = `auto_send_lane: ${candidate.intent} is a safe canned reply, supervisor escalation overruled. Original reason: ${verdict.reason}`;
    verdict.riskFlags = [...verdict.riskFlags, "auto_send_override"];
  }

  // Replay metadata — store enough to re-run this decision after a prompt
  // change. promptVersion + model lets `WHERE prompt_version=...` queries
  // bucket history by supervisor version; candidate snapshot captures what
  // the deterministic side saw at the moment.
  const replayMeta = {
    prompt_version: verdict.promptVersion,
    model: verdict.model,
    candidate: {
      kind: candidate.kind,
      intent: candidate.intent,
      intent_confidence: candidate.intentConfidence,
      intent_summary: candidate.intentSummary,
      description: candidate.description,
      canned_reply_label: candidate.cannedReplyLabel ?? null,
    },
  };

  const logBase = {
    manychatSubId: jid,
    messageId: inboundMessageId,
    inboundText,
    stageBefore: stage,
    llmIntent: verdict.intent,
    llmConfidence: verdict.confidence,
    llmRecommended: verdict.recommended,
    llmReason: verdict.reason,
    llmRiskFlags: verdict.riskFlags,
  };

  if (verdict.recommended === "supervisor_error") {
    await logDecision({
      ...logBase,
      decidedBy: "supervisor_error",
      action: "no_op",
      metadata: { ...replayMeta, rawJson: verdict.rawJson },
    });
    return;
  }

  if (verdict.recommended === "silence") {
    await logDecision({
      ...logBase,
      decidedBy: "silent",
      action: "no_op",
      metadata: { ...replayMeta, rawJson: verdict.rawJson },
    });
    return;
  }

  if (verdict.recommended === "escalate_to_eli") {
    let draftId: number | null = null;
    try {
      draftId = await generateAndQueueDraft({
        manychatSubId: jid,
        moneyReason: "manual",
        pipelineStage: stage,
        leadName: freshLead?.name ?? null,
        botSummary: verdict.reason,
        triggerMessageId: inboundMessageId,
      });
    } catch (e) {
      console.error("[supervisor.route] draft generation failed", e);
    }
    try {
      const who = freshLead?.name?.trim() || freshLead?.phone || jid;
      await sendEliDM(
        `🤖 Supervisor escalation — ${who} (${stage ?? "no stage"})\n` +
          `Inbound: "${inboundText.slice(0, 200)}"\n` +
          `LLM reason: ${verdict.reason}\n` +
          (draftId ? `Draft #${draftId} ready in /dashboard/v3/drafts` : "Draft generation failed — reply manually from CRM.")
      );
    } catch (e) {
      console.error("[supervisor.route] eli DM failed", e);
    }

    // AUTO-ACK to customer — never let an escalation feel like a ghost.
    // Supervisor decided to hand off to Eli, but the customer just sent a
    // message and would otherwise see nothing. Short, neutral ack so they
    // know we received it. Eli's draft / manual reply follows up later.
    // Skip auto-ack if the candidate already produced a canned reply that
    // would have been informative — avoids double-messaging on edge cases.
    let ackSent = false;
    try {
      await sendBridgeMessage(
        jid,
        "תודה על ההודעה 🙏 אבדוק ואחזור אליכם בהקדם."
      );
      ackSent = true;
    } catch (e) {
      console.error("[supervisor.route] auto-ack send failed", e);
    }

    await logDecision({
      ...logBase,
      decidedBy: "code",
      action: draftId ? "draft_queued" : "escalated",
      escalationKind: "supervisor_decision",
      draftId,
      replyText: ackSent
        ? "תודה על ההודעה 🙏 אבדוק ואחזור אליכם בהקדם."
        : null,
      metadata: { ...replayMeta, rawJson: verdict.rawJson, auto_ack_sent: ackSent },
    });
    return;
  }

  if (verdict.recommended === "override_with_text") {
    if (!verdict.overrideText) {
      // LLM said override but didn't supply text. Treat as approve_code.
      console.warn("[supervisor.route] override_with_text with no text — falling back to approve_code");
    } else {
      try {
        await sendBridgeMessage(jid, verdict.overrideText);
      } catch (e) {
        console.error("[supervisor.route] override send failed", e);
        await logDecision({
          ...logBase,
          decidedBy: "llm_override",
          action: "no_op",
          replyText: verdict.overrideText,
          metadata: { ...replayMeta, sendError: e instanceof Error ? e.message : String(e), rawJson: verdict.rawJson },
        });
        return;
      }
      await logDecision({
        ...logBase,
        decidedBy: "llm_override",
        action: "reply_sent",
        replyText: verdict.overrideText,
        metadata: { ...replayMeta, rawJson: verdict.rawJson, note: "override skipped existing handler — stage NOT transitioned" },
      });
      return;
    }
  }

  // approve_code (and fallback from missing-override-text). Run the legacy handler.
  await runLegacyHandlerAndLog({
    jid,
    stage,
    inboundMessageId,
    text: textForRouting,
    mediaPresent,
    inboundLogText: inboundText,
    supervisor: {
      intent: verdict.intent,
      confidence: verdict.confidence,
      recommended: verdict.recommended,
      reason: verdict.reason,
      riskFlags: verdict.riskFlags,
      candidate: candidate.kind,
      rawJson: verdict.rawJson,
      replayMeta,
    },
  });
}

async function runLegacyHandlerAndLog(args: {
  jid: string;
  stage: string | null;
  inboundMessageId: number | null;
  text: string | null;
  mediaPresent: boolean;
  inboundLogText: string;
  supervisor?: {
    intent: string | null;
    confidence: number | null;
    recommended: string;
    reason: string;
    riskFlags: string[];
    candidate: string;
    rawJson: string | null;
    replayMeta?: Record<string, unknown>;
  };
}): Promise<void> {
  const { jid, stage, inboundMessageId, text, mediaPresent, inboundLogText } = args;
  let result: any = null;
  let handlerName = "noop";

  try {
    if (!stage || stage === "NEW") {
      handlerName = "handleInbound";
      result = await handleInbound({ sid: jid, text });
    } else if (
      stage === "AWAITING_ESTIMATE" ||
      stage === "AWAITING_LOGO" ||
      stage === "AWAITING_FINAL"
    ) {
      handlerName = "handleDecisionInbound";
      result = await handleDecisionInbound({ sid: jid, text, hasMedia: mediaPresent });
    } else {
      // WAITING_FACTORY / WON / DROPPED — supervisor said approve_code but
      // there's no handler. This is a no_op the supervisor probably should
      // have escalated; log it so we catch the case.
      console.log("[supervisor.route] approve_code for silent stage — no handler", jid, stage);
    }
  } catch (e) {
    console.error("[supervisor.route] legacy handler error", handlerName, e);
  }

  // Reload stage AFTER the handler runs so we capture stage transitions.
  const stageAfter = ((await getLeadStage(jid)) || "").toUpperCase() || null;
  const handlerAction = mapHandlerResultToAction(result);

  // SAFETY NET: supervisor approved code, but code silently no_op'd
  // (e.g. questionnaire bailed, unknown stage, edge case the handler can't
  // resolve). Customer would be ghosted. Auto-escalate so Eli sees it.
  // This is the "never silent after approve_code" promise.
  const handlerSilent =
    handlerAction === "no_op" &&
    (args.supervisor?.recommended === "approve_code" || !args.supervisor);
  if (handlerSilent && inboundLogText !== "(empty)" && inboundLogText !== "(media-only)") {
    console.warn(
      "[supervisor.route] safety net: handler silent after approve_code, escalating",
      jid,
      handlerName
    );
    let draftId: number | null = null;
    try {
      const [leadRow] = await db
        .select({ name: leads.name, phone: leads.phoneE164 })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${jid.trim()}`)
        .limit(1);
      try {
        draftId = await generateAndQueueDraft({
          manychatSubId: jid,
          moneyReason: "manual",
          pipelineStage: stage,
          leadName: leadRow?.name ?? null,
          botSummary: `Handler ${handlerName} returned no_op after supervisor approve_code — auto-escalated to avoid ghosting`,
          triggerMessageId: inboundMessageId,
        });
      } catch (e) {
        console.error("[supervisor.route] safety-net draft generation failed", e);
      }
      try {
        const who = leadRow?.name?.trim() || leadRow?.phone || jid;
        await sendEliDM(
          `⚠️ Safety net — ${who} (${stage ?? "no stage"})\n` +
            `Inbound: "${inboundLogText.slice(0, 200)}"\n` +
            `Bot silently no-op'd (${handlerName}). Customer awaits reply.\n` +
            (draftId
              ? `Draft #${draftId} ready in /dashboard/v3/drafts`
              : "Draft generation failed — reply manually from CRM.")
        );
      } catch (e) {
        console.error("[supervisor.route] safety-net Eli DM failed", e);
      }
    } catch (e) {
      console.error("[supervisor.route] safety-net escalation failed", e);
    }

    // AUTO-ACK to customer so they don't see a ghost.
    let safetyAckSent = false;
    try {
      await sendBridgeMessage(
        jid,
        "תודה על ההודעה 🙏 אבדוק ואחזור אליכם בהקדם."
      );
      safetyAckSent = true;
    } catch (e) {
      console.error("[supervisor.route] safety-net auto-ack failed", e);
    }

    await logDecision({
      manychatSubId: jid,
      messageId: inboundMessageId,
      inboundText: inboundLogText,
      stageBefore: stage,
      stageAfter,
      llmIntent: args.supervisor?.intent ?? null,
      llmConfidence: args.supervisor?.confidence ?? null,
      llmRecommended: (args.supervisor?.recommended as any) ?? null,
      llmReason: args.supervisor?.reason ?? null,
      llmRiskFlags: args.supervisor?.riskFlags ?? null,
      decidedBy: "code",
      action: draftId ? "draft_queued" : "escalated",
      escalationKind: "safety_net_silent_handler",
      draftId,
      replyText: safetyAckSent
        ? "תודה על ההודעה 🙏 אבדוק ואחזור אליכם בהקדם."
        : null,
      metadata: {
        ...(args.supervisor?.replayMeta ?? {}),
        candidate_kind: args.supervisor?.candidate ?? null,
        handler: handlerName,
        handlerResult: result,
        rawJson: args.supervisor?.rawJson ?? null,
        safety_net_triggered: true,
        auto_ack_sent: safetyAckSent,
      },
    });
    return;
  }

  await logDecision({
    manychatSubId: jid,
    messageId: inboundMessageId,
    inboundText: inboundLogText,
    stageBefore: stage,
    stageAfter,
    llmIntent: args.supervisor?.intent ?? null,
    llmConfidence: args.supervisor?.confidence ?? null,
    llmRecommended: (args.supervisor?.recommended as any) ?? null,
    llmReason: args.supervisor?.reason ?? null,
    llmRiskFlags: args.supervisor?.riskFlags ?? null,
    decidedBy: "code",
    action: handlerAction,
    replyText: null, // handler did its own send; reply text recovery would require deeper refactor
    metadata: {
      ...(args.supervisor?.replayMeta ?? {}),
      candidate_kind: args.supervisor?.candidate ?? null,
      handler: handlerName,
      handlerResult: result,
      rawJson: args.supervisor?.rawJson ?? null,
    },
  });
}

function mapHandlerResultToAction(result: any): "reply_sent" | "sub_state_advanced" | "escalated" | "stage_transition" | "no_op" {
  const a = result?.action;
  if (!a) return "no_op";

  // Explicit no-op / escalation paths.
  if (a === "no_op") return "no_op";
  if (a === "escalated" || a === "bailed") return "escalated";
  if (a === "sub_state_advanced") return "sub_state_advanced";

  // Stage transitions / lifecycle completions.
  if (
    a === "accept_routed" ||
    a === "logo_received" ||
    a === "won_routed" ||
    a === "completed_standard" ||
    a === "completed_factory"
  )
    return "stage_transition";

  // Everything else from the questionnaire / decision engines is a reply
  // the bot actually sent (started, reasked, answered, custom_prompt,
  // custom_captured, size_page_2, confirmation_*, samples_sent, canned_reply,
  // logo_reasked, etc.). Treat as reply_sent so the safety net doesn't
  // mistakenly fire an auto-ack on top of an already-delivered reply.
  return "reply_sent";
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

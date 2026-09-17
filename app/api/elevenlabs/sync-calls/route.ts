/**
 * ElevenLabs → GHL bridge cron. ADDITIVE sibling of
 * /api/bot/process-recordings (GHL-native dialer recordings) — neither touches
 * the other. Polls ElevenLabs Conversational AI calls and, for each, writes a
 * Hebrew analysis note + attaches the playable recording to the GHL contact.
 *
 * Pipeline (each stage independent per row; partial failures don't block):
 *   stage 1 discover  : list conversations since cursor → insert rows
 *   stage 2 enrich    : pull transcript + phone/direction/duration
 *   stage 3 analyze   : analyzeCall(transcript) → structured Hebrew analysis
 *   stage 4 post      : resolve GHL contact by phone → note + audio attachment
 *
 * Auth: Bearer BOT_SECRET (or CALL_TRIGGER_SECRET). Trigger: Vercel routine.
 * Idempotency: conversation_id UNIQUE (stage 1) + `[CALL-ANALYSIS-11L v1]
 * conv=<id>` note marker (stage 4).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appConfig, elevenlabsCallImports, leads } from "@/drizzle/schema";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  listConversations,
  getConversation,
  buildTranscriptText,
  extractCallMeta,
  recordingProxyUrl,
} from "@/lib/elevenlabs/client";
import {
  addContactNote,
  listContactNotes,
  findContactByPhone,
  upsertContact,
  uploadMediaFromUrl,
  postOutboundMessage,
} from "@/integrations/ghl/client";
import {
  GHL_CONVERSATION_PROVIDER_ID,
  requireGHLLocationId,
} from "@/integrations/ghl/config";
import { getValidAccessToken } from "@/integrations/ghl/oauth";
import { analyzeCall } from "@/lib/autoresponder/call-analysis";
import { withJob } from "@/lib/observability/jobs";
import { getBotSettings } from "@/lib/bot-settings/store";
import { buildCallAnalysisNote } from "@/lib/calls/note-builder";
import { processCallAction } from "@/lib/calls/process-action";
import { normalizeCallAnalysisV2 } from "@/lib/calls/analysis-normalize";
import { logger, serializeError } from "@/lib/observability/log";

export const runtime = "nodejs";
export const maxDuration = 300;

const CURSOR_KEY = "elevenlabs.last_polled_unix";
const NOTE_MARKER_VERSION = "CALL-ANALYSIS-11L v2";
const MAX_ATTEMPTS = 3;
const PER_STAGE_CAP = 5;
const REWIND_SECS = 30 * 60; // belt-and-suspenders overlap each tick
const log = logger("calls");

function authorized(req: NextRequest): boolean {
  const accepted = [process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter((s): s is string => Boolean(s));
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return accepted.some((s) => header === `Bearer ${s}`);
}

function markerFor(conversationId: string): string {
  return `[${NOTE_MARKER_VERSION}] conv=${conversationId}`;
}

function legacyMarkerFor(conversationId: string): string {
  return `[CALL-ANALYSIS-11L v1] conv=${conversationId}`;
}

// ---- cursor (epoch seconds) ----
async function getCursorUnix(): Promise<number> {
  const row = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, CURSOR_KEY))
    .limit(1);
  const u = (row[0]?.value as { unix?: number } | undefined)?.unix;
  if (typeof u === "number") return u;
  return Math.floor(Date.now() / 1000) - 24 * 60 * 60; // first run: 24h back
}

async function setCursorUnix(unix: number): Promise<void> {
  const value = { unix };
  await db
    .insert(appConfig)
    .values({ key: CURSOR_KEY, value })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

async function recordError(id: number, err: unknown, giveUp: boolean): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await db
    .update(elevenlabsCallImports)
    .set({
      lastError: msg.slice(0, 1000),
      lastErrorAt: new Date(),
      attempts: sql`${elevenlabsCallImports.attempts} + 1`,
      status: giveUp ? "failed" : elevenlabsCallImports.status,
      updatedAt: new Date(),
    })
    .where(eq(elevenlabsCallImports.id, id));
}

// ===========================================================================
// Stages
// ===========================================================================

async function stageDiscover(): Promise<number> {
  const agentId = process.env.ELEVENLABS_AGENT_ID || undefined;
  const cursor = await getCursorUnix();
  const convos = await listConversations({
    agentId,
    pageSize: 30,
    callStartAfterUnix: Math.max(0, cursor - REWIND_SECS),
  });
  let inserted = 0;
  for (const c of convos) {
    if (c.status && c.status !== "done") continue;
    const res = await db
      .insert(elevenlabsCallImports)
      .values({
        conversationId: c.conversation_id,
        agentId: c.agent_id,
        callStartedAt: c.start_time_unix_secs
          ? new Date(c.start_time_unix_secs * 1000)
          : null,
        callDurationSec: c.call_duration_secs ?? null,
        status: "pending",
      })
      .onConflictDoNothing({ target: elevenlabsCallImports.conversationId })
      .returning({ id: elevenlabsCallImports.id });
    if (res.length > 0) inserted++;
  }
  await setCursorUnix(Math.floor(Date.now() / 1000));
  return inserted;
}

async function stageEnrich(): Promise<number> {
  const rows = await db
    .select()
    .from(elevenlabsCallImports)
    .where(
      and(
        isNull(elevenlabsCallImports.transcript),
        ne(elevenlabsCallImports.status, "failed"),
        ne(elevenlabsCallImports.status, "skipped_empty"),
        ne(elevenlabsCallImports.status, "skipped_no_contact")
      )
    )
    .limit(PER_STAGE_CAP);
  let done = 0;
  for (const row of rows) {
    try {
      const detail = await getConversation(row.conversationId);
      const transcript = buildTranscriptText(detail);
      const meta = extractCallMeta(detail);
      if (!transcript.trim()) {
        await db
          .update(elevenlabsCallImports)
          .set({ status: "skipped_empty", updatedAt: new Date() })
          .where(eq(elevenlabsCallImports.id, row.id));
        continue;
      }
      await db
        .update(elevenlabsCallImports)
        .set({
          transcript,
          elevenSummary: meta.summary,
          phone: meta.phone,
          direction: meta.direction,
          callDurationSec: meta.durationSec ?? row.callDurationSec,
          callStartedAt: meta.startedAt ?? row.callStartedAt,
          agentId: detail.agent_id ?? row.agentId,
          enrichedAt: new Date(),
          status: "enriched",
          updatedAt: new Date(),
        })
        .where(eq(elevenlabsCallImports.id, row.id));
      done++;
    } catch (e) {
      await recordError(row.id, e, row.attempts + 1 >= MAX_ATTEMPTS);
    }
  }
  return done;
}

async function stageAnalyze(): Promise<number> {
  const settings = await getBotSettings();
  if (!settings.callAnalysisEnabled || !settings.callAnalysisElevenlabsEnabled) return 0;
  const rows = await db
    .select()
    .from(elevenlabsCallImports)
    .where(
      and(
        isNotNull(elevenlabsCallImports.enrichedAt),
        isNull(elevenlabsCallImports.analyzedAt),
        ne(elevenlabsCallImports.status, "failed")
      )
    )
    .limit(PER_STAGE_CAP);
  let done = 0;
  for (const row of rows) {
    try {
      const analysis = await analyzeCall(row.transcript ?? "", { callStartedAt: row.callStartedAt });
      await db
        .update(elevenlabsCallImports)
        .set({
          analysis: analysis ?? null,
          analyzedAt: new Date(),
          status: "analyzed",
          updatedAt: new Date(),
        })
        .where(eq(elevenlabsCallImports.id, row.id));
      done++;
    } catch (e) {
      await recordError(row.id, e, row.attempts + 1 >= MAX_ATTEMPTS);
    }
  }
  return done;
}

async function stagePost(): Promise<number> {
  const settings = await getBotSettings();
  if (!settings.callAnalysisEnabled || !settings.callAnalysisElevenlabsEnabled) return 0;
  const rows = await db
    .select()
    .from(elevenlabsCallImports)
    .where(
      and(
        isNotNull(elevenlabsCallImports.analyzedAt),
        isNull(elevenlabsCallImports.postedBackAt),
        ne(elevenlabsCallImports.status, "failed")
      )
    )
    .limit(PER_STAGE_CAP);
  let done = 0;
  for (const row of rows) {
    try {
      // 1. Resolve contact by phone. No phone (web/widget call) → can't bind.
      if (!row.phone) {
        await db
          .update(elevenlabsCallImports)
          .set({ status: "skipped_no_contact", updatedAt: new Date() })
          .where(eq(elevenlabsCallImports.id, row.id));
        continue;
      }
      let contactId =
        row.ghlContactId ?? (await findContactByPhone(row.phone))?.id ?? null;
      if (!contactId) {
        // Lead-capture call from an unknown number → create the contact.
        const created = await upsertContact({
          phone: row.phone,
          source: "elevenlabs-call",
        });
        contactId = created.contact?.id ?? null;
      }
      if (!contactId) {
        await recordError(row.id, new Error("no GHL contact id"), row.attempts + 1 >= MAX_ATTEMPTS);
        continue;
      }

      if (row.analysis) {
        const analysis = normalizeCallAnalysisV2(row.analysis, {
          transcript: row.transcript ?? "",
          callStartedAt: row.callStartedAt ?? row.createdAt,
          model: null,
        });
        const [actionLead] = await db
          .select({ sid: leads.manychatSubId })
          .from(leads)
          .where(eq(leads.ghlContactId, contactId))
          .limit(1);
        await processCallAction({
          source: "elevenlabs",
          sourceRecordId: row.conversationId,
          leadSid: actionLead?.sid ?? null,
          ghlContactId: contactId,
          callStartedAt: row.callStartedAt,
          analysis,
        }).catch((error) =>
          log.warn("call_action.processing_failed", {
            conversationId: row.conversationId,
            contactId,
            ...serializeError(error),
          }),
        );
      }

      const marker = markerFor(row.conversationId);

      // 2. Idempotency — note already posted?
      let noteId: string | null = null;
      if (settings.callAnalysisPublishNote) {
        const existing = await listContactNotes(contactId);
        const legacyMarker = legacyMarkerFor(row.conversationId);
        const already = existing.find(
          (n) => (n.body ?? "").includes(marker) || (n.body ?? "").includes(legacyMarker),
        );
        if (already) {
          noteId = already.id;
        } else if (row.analysis) {
          const analysis = normalizeCallAnalysisV2(row.analysis, {
            transcript: row.transcript ?? "",
            callStartedAt: row.callStartedAt ?? row.createdAt,
            model: null,
          });
          const body = buildCallAnalysisNote({
          marker,
          sourceLabel: "שיחת סוכן קולי (ElevenLabs)",
          startedAt: row.callStartedAt,
          durationSec: row.callDurationSec,
          direction: row.direction,
          analysis,
          transcript: row.transcript ?? "",
          settings,
          });
          const note = await addContactNote(contactId, body);
          noteId = note.id;
        }
      }

      // 3. Attach the playable recording via the Custom Conversation Provider.
      // Non-fatal: a note without audio is still useful, so audio failure
      // doesn't block marking the row posted.
      let recordingGhlUrl: string | null = row.recordingGhlUrl;
      let attachedMessageId: string | null = row.attachedMessageId;
      let audioError: string | null = null;
      try {
        const accessToken =
          (await getValidAccessToken(requireGHLLocationId())) ?? undefined;
        const providerId = GHL_CONVERSATION_PROVIDER_ID || undefined;
        if (accessToken && providerId && !recordingGhlUrl) {
          const uploaded = await uploadMediaFromUrl({
            url: recordingProxyUrl(row.conversationId),
            filename: `${row.conversationId}.mp3`,
            mimeType: "audio/mpeg",
            accessToken,
          });
          recordingGhlUrl = uploaded.url;
          const sent = await postOutboundMessage({
            contactId,
            message: "🔊 הקלטת שיחת סוכן קולי",
            type: "Custom",
            conversationProviderId: providerId,
            attachments: [uploaded.url],
            accessToken,
          });
          attachedMessageId = sent.messageId ?? null;
        }
      } catch (e) {
        audioError = e instanceof Error ? e.message : String(e);
      }

      await db
        .update(elevenlabsCallImports)
        .set({
          ghlContactId: contactId,
          postedNoteId: noteId,
          recordingGhlUrl,
          attachedMessageId,
          postedBackAt: new Date(),
          status: "posted",
          lastError: audioError ? `audio: ${audioError}`.slice(0, 1000) : null,
          lastErrorAt: audioError ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(elevenlabsCallImports.id, row.id));
      done++;
    } catch (e) {
      await recordError(row.id, e, row.attempts + 1 >= MAX_ATTEMPTS);
    }
  }
  return done;
}

const run = withJob("elevenlabs-sync", "elevenlabs", async (req: NextRequest, log) => {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const discovered = await stageDiscover();
    const enriched = await stageEnrich();
    const analyzed = await stageAnalyze();
    const posted = await stagePost();
    log.info("sync_calls.run", { discovered, enriched, analyzed, posted });
    return NextResponse.json({
      ok: true,
      discovered,
      enriched,
      analyzed,
      posted,
    });
  } catch (e) {
    log.error("sync_calls.failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
});

export const POST = run;
// Allow manual GET trigger for testing (same auth).
export const GET = run;

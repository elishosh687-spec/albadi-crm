/**
 * Call-recording cron. Pulls new GHL call recordings, transcribes via Whisper,
 * analyzes with GPT, and writes a structured Hebrew note back to the GHL
 * contact. Each stage runs independently per row, so partial failures don't
 * block others.
 *
 * Pipeline:
 *   stage 1: poll GHL for new TYPE_CALL messages since cursor → insert rows
 *   stage 2: transcribe rows WHERE transcript IS NULL AND status != failed
 *   stage 3: analyze rows WHERE transcribed_at NOT NULL AND analyzed_at IS NULL
 *   stage 4: post note for rows WHERE analyzed_at NOT NULL AND posted_back_at IS NULL
 *
 * Auth: Bearer BOT_SECRET. Trigger: Vercel Cloud Routine every 5 min.
 *
 * Idempotency: stage 1 dedupes on `ghl_message_id` UNIQUE. Stage 4 lists the
 * contact's existing notes and skips if a `[CALL-ANALYSIS v1] msg=<id>`
 * marker is already present.
 *
 * Retry safety: per-row `attempts` increments + `last_error*` capture; rows
 * with attempts ≥ MAX_ATTEMPTS get status='failed' and are skipped until
 * manually replayed.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appConfig, callRecordingImports, leads } from "@/drizzle/schema";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  addContactNote,
  downloadRecording,
  listContactNotes,
  searchCallMessages,
} from "@/integrations/ghl/client";
import { recordBotFunnelEvent } from "@/lib/autoresponder/funnel-events";
import { GHL_FIELD_IDS } from "@/integrations/ghl/config";
import { updateContact } from "@/integrations/ghl/client";
import { transcribeAudio, TranscribeError } from "@/lib/transcription/whisper";
import { analyzeCall } from "@/lib/autoresponder/call-analysis";
import { logger, serializeError } from "@/lib/observability/log";
import { withJob } from "@/lib/observability/jobs";
import { getBotSettings } from "@/lib/bot-settings/store";
import { buildCallAnalysisNote } from "@/lib/calls/note-builder";
import { processCallAction } from "@/lib/calls/process-action";
import { normalizeCallAnalysisV2 } from "@/lib/calls/analysis-normalize";

export const runtime = "nodejs";
export const maxDuration = 300;

const log = logger("calls");

const CURSOR_KEY = "call_recordings.last_polled_at";
const CURSOR_OVERLAP_MS = 30 * 60 * 1000; // 30min belt-and-suspenders rewind
// Bumped from 5 to 10 to chew through the historical backfill faster.
// 10 × Whisper turnaround (~15s) ≈ 150s, well under maxDuration=300s.
// Whisper rate limit is 50 RPM — we're at ~2 RPM at this cap.
const MAX_PER_TICK_DOWNLOADS = 10;
const MAX_ATTEMPTS = 3;
const NOTE_MARKER_VERSION = "CALL-ANALYSIS v2";

function authorized(req: NextRequest): boolean {
  // Accept either BOT_SECRET (shared with the rest of the internal API) or
  // CALL_TRIGGER_SECRET (a dedicated, non-sensitive value used by the
  // local Claude scheduled task — see CLAUDE.md §"GHL call recording
  // analysis pipeline" for why both exist).
  const accepted = [process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter((s): s is string => Boolean(s));
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return accepted.some((s) => header === `Bearer ${s}`);
}

function markerFor(messageId: string): string {
  return `[${NOTE_MARKER_VERSION}] msg=${messageId}`;
}

function legacyMarkerFor(messageId: string): string {
  return `[CALL-ANALYSIS v1] msg=${messageId}`;
}

async function getCursor(): Promise<Date> {
  const row = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, CURSOR_KEY))
    .limit(1);
  if (row[0]) {
    const ts = (row[0].value as { iso?: string })?.iso;
    if (ts) return new Date(ts);
  }
  // First run: look back 24h.
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

async function setCursor(d: Date): Promise<void> {
  const value = { iso: d.toISOString() };
  // Upsert by primary key.
  await db
    .insert(appConfig)
    .values({ key: CURSOR_KEY, value })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

async function recordError(
  id: number,
  err: unknown,
  giveUp: boolean,
): Promise<void> {
  // Capture both the error message AND any structured detail (e.g.
  // TranscribeError.detail holds OpenAI's response body excerpt). Without
  // detail we'd just see "OpenAI transcription failed: 400" with no clue
  // why.
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
    const detail = (err as Error & { detail?: string }).detail;
    if (detail) msg += `\n  detail: ${detail}`;
  } else {
    msg = String(err);
  }
  await db
    .update(callRecordingImports)
    .set({
      attempts: sql`${callRecordingImports.attempts} + 1`,
      lastError: msg.slice(0, 2000),
      lastErrorAt: new Date(),
      status: giveUp ? "failed" : "pending",
      updatedAt: new Date(),
    })
    .where(eq(callRecordingImports.id, id));
}

// ===========================================================================
// Stage 1 — poll GHL and insert new rows.
// ===========================================================================
async function stage1Discover(): Promise<{ inserted: number; scanned: number }> {
  const cursor = await getCursor();
  const startAfterDate = new Date(cursor.getTime() - CURSOR_OVERLAP_MS).toISOString();

  const calls = await searchCallMessages({ startAfterDate, limit: 100 });
  let inserted = 0;
  const newestSeen: Date[] = [];

  const touchedContacts = new Set<string>();
  for (const c of calls) {
    const status = c.meta?.call?.status;
    const completed = !status || status === "completed";

    // Completed calls: wait ~60s for GHL to attach the recording binary before
    // ingesting (else the download 404s). Non-answered calls (no-answer/busy/
    // voicemail) have no recording — ingest them immediately: they still count
    // as a call ATTEMPT and must stamp the "last call" field (a call the
    // customer didn't pick up is a signal too).
    if (completed && c.dateAdded) {
      const age = Date.now() - new Date(c.dateAdded).getTime();
      if (age < 60_000) continue;
    }
    if (c.dateAdded) newestSeen.push(new Date(c.dateAdded));

    try {
      await db.insert(callRecordingImports).values({
        ghlMessageId: c.id,
        ghlContactId: c.contactId ?? "",
        ghlConversationId: c.conversationId,
        callDurationSec: c.meta?.call?.duration ?? null,
        callStartedAt: c.dateAdded ? new Date(c.dateAdded) : null,
        recordingUrl: completed ? (c.meta?.call?.recordingUrl ?? null) : null,
        // Non-answered → terminal 'no_answer' (skips transcription/analysis) but
        // still counts toward the last-call field. Completed → normal pipeline.
        status: completed ? "pending" : "no_answer",
      });
      inserted++;
      if (c.contactId) touchedContacts.add(c.contactId);
    } catch (e) {
      // Likely unique violation on ghl_message_id — that's the dedupe path.
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("duplicate") && !msg.includes("unique")) {
        log.error("discover.insert_failed", e, { messageId: c.id, contactId: c.contactId ?? null });
      }
    }
  }

  // Stamp "Last Call Date" for each contact with a NEW call this tick — from
  // MAX(call_started_at) over ALL their calls (answered + unanswered), so an
  // unanswered attempt updates it immediately without waiting for stage 4.
  for (const cid of touchedContacts) {
    await stampLastCall(cid);
  }

  // Advance cursor to the newest dateAdded we saw (or leave it as-is).
  if (newestSeen.length > 0) {
    const newest = new Date(Math.max(...newestSeen.map((d) => d.getTime())));
    await setCursor(newest);
  }

  return { inserted, scanned: calls.length };
}

// ===========================================================================
// Stage 2 — transcribe pending rows.
// ===========================================================================
async function stage2Transcribe(): Promise<{ done: number }> {
  const rows = await db
    .select()
    .from(callRecordingImports)
    .where(
      and(
        isNull(callRecordingImports.transcript),
        sql`${callRecordingImports.status} not in ('failed','skipped_oversize','skipped_voicemail','skipped_no_recording','no_answer')`,
        lte(callRecordingImports.attempts, MAX_ATTEMPTS),
      ),
    )
    .limit(MAX_PER_TICK_DOWNLOADS);

  let done = 0;
  for (const row of rows) {
    try {
      await db
        .update(callRecordingImports)
        .set({ status: "transcribing", updatedAt: new Date() })
        .where(eq(callRecordingImports.id, row.id));

      const { audio, contentType } = await downloadRecording(row.ghlMessageId);
      // Let the wrapper derive the filename extension from contentType —
      // Whisper 400s when extension and content type disagree (we observed
      // this with audio/x-wav being sent as .mp3 → 400).
      const transcript = await transcribeAudio(audio, { contentType });

      await db
        .update(callRecordingImports)
        .set({
          transcript,
          transcribedAt: new Date(),
          status: "analyzing",
          updatedAt: new Date(),
        })
        .where(eq(callRecordingImports.id, row.id));
      done++;
    } catch (err) {
      // Special-case the oversize error so we don't burn retries on it.
      if (err instanceof TranscribeError && err.kind === "too_large") {
        await db
          .update(callRecordingImports)
          .set({
            status: "skipped_oversize",
            lastError: err.message,
            lastErrorAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(callRecordingImports.id, row.id));
      } else if (
        err instanceof Error &&
        /does not have recording/i.test(err.message)
      ) {
        // GHL 422 "Message does not have recording" — legitimate, not a
        // pipeline failure. Happens on missed calls, voicemail entries
        // where recording wasn't captured, etc. Mark terminal so we don't
        // retry, and keep these out of the 'failed' bucket which is
        // reserved for actual errors.
        await db
          .update(callRecordingImports)
          .set({
            status: "skipped_no_recording",
            lastError: "GHL reports no recording attached to this call message",
            lastErrorAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(callRecordingImports.id, row.id));
      } else {
        await recordError(row.id, err, row.attempts + 1 >= MAX_ATTEMPTS);
      }
    }
  }
  return { done };
}

// ===========================================================================
// Stage 3 — analyze transcripts.
// ===========================================================================
async function stage3Analyze(): Promise<{ done: number }> {
  const settings = await getBotSettings();
  if (!settings.callAnalysisEnabled || !settings.callAnalysisGhlEnabled) return { done: 0 };
  const rows = await db
    .select()
    .from(callRecordingImports)
    .where(
      and(
        isNotNull(callRecordingImports.transcript),
        isNull(callRecordingImports.analyzedAt),
        sql`${callRecordingImports.status} not in ('failed','skipped_oversize','skipped_voicemail','skipped_no_recording','no_answer')`,
        lte(callRecordingImports.attempts, MAX_ATTEMPTS),
      ),
    )
    .limit(MAX_PER_TICK_DOWNLOADS);

  let done = 0;
  for (const row of rows) {
    try {
      const analysis = await analyzeCall(row.transcript ?? "", {
        callStartedAt: row.callStartedAt,
      });
      if (!analysis) {
        await recordError(
          row.id,
          new Error("analyzeCall returned null"),
          row.attempts + 1 >= MAX_ATTEMPTS,
        );
        continue;
      }
      await db
        .update(callRecordingImports)
        .set({
          analysis,
          analyzedAt: new Date(),
          status: "analyzing",
          updatedAt: new Date(),
        })
        .where(eq(callRecordingImports.id, row.id));
      done++;
    } catch (err) {
      await recordError(row.id, err, row.attempts + 1 >= MAX_ATTEMPTS);
    }
  }
  return { done };
}

// ===========================================================================
// Stage 4 — post note back to GHL contact.
// ===========================================================================
/**
 * Stamp the "Last Call Date" GHL custom field (calls-only, sortable in GHL —
 * unlike GHL's mixed "Last activity") to the contact's MOST-RECENT call date.
 * Uses MAX over all the contact's calls so it's order-independent (a late
 * re-processed old call can't overwrite a newer date). Non-fatal + no-ops until
 * GHL_FIELD_LAST_CALL_AT is configured.
 */
async function stampLastCall(contactId: string): Promise<void> {
  if (!GHL_FIELD_IDS.last_call_at || !contactId) return;
  try {
    const [row] = await db
      .select({ maxAt: sql<string | null>`max(${callRecordingImports.callStartedAt})` })
      .from(callRecordingImports)
      .where(eq(callRecordingImports.ghlContactId, contactId));
    if (!row?.maxAt) return;
    await updateContact(contactId, {
      customFields: [
        { id: GHL_FIELD_IDS.last_call_at, value: new Date(row.maxAt).toISOString() },
      ],
    });
  } catch (err) {
    log.warn("last_call.stamp_failed", { contactId, ...serializeError(err) });
  }
}

async function stage4PostBack(): Promise<{ done: number }> {
  const settings = await getBotSettings();
  if (!settings.callAnalysisEnabled || !settings.callAnalysisGhlEnabled) return { done: 0 };
  const rows = await db
    .select()
    .from(callRecordingImports)
    .where(
      and(
        isNotNull(callRecordingImports.analyzedAt),
        isNull(callRecordingImports.postedBackAt),
        sql`${callRecordingImports.status} not in ('failed','skipped_oversize','skipped_voicemail','skipped_no_recording','no_answer')`,
        lte(callRecordingImports.attempts, MAX_ATTEMPTS),
      ),
    )
    .limit(MAX_PER_TICK_DOWNLOADS);

  let done = 0;
  for (const row of rows) {
    try {
      if (!row.ghlContactId) {
        await recordError(
          row.id,
          new Error("missing ghl_contact_id"),
          true,
        );
        continue;
      }

      // Stamp the calls-only "Last Call Date" field. Before the marker
      // early-return so it's set even on already-noted (re-processed) calls.
      await stampLastCall(row.ghlContactId);

      const [actionLead] = await db
        .select({ sid: leads.manychatSubId })
        .from(leads)
        .where(eq(leads.ghlContactId, row.ghlContactId))
        .limit(1);
      const analysis = normalizeCallAnalysisV2(row.analysis, {
        transcript: row.transcript ?? "",
        callStartedAt: row.callStartedAt ?? row.createdAt,
        model: null,
      });
      await processCallAction({
        source: "ghl",
        sourceRecordId: row.ghlMessageId,
        leadSid: actionLead?.sid ?? null,
        ghlContactId: row.ghlContactId,
        callStartedAt: row.callStartedAt,
        analysis,
      }).catch((error) =>
        log.warn("call_action.processing_failed", {
          messageId: row.ghlMessageId,
          contactId: row.ghlContactId,
          ...serializeError(error),
        }),
      );

      if (!settings.callAnalysisPublishNote) {
        await db
          .update(callRecordingImports)
          .set({ postedBackAt: new Date(), status: "posted", updatedAt: new Date() })
          .where(eq(callRecordingImports.id, row.id));
        const [lead] = await db
          .select({ sid: leads.manychatSubId })
          .from(leads)
          .where(eq(leads.ghlContactId, row.ghlContactId))
          .limit(1);
        if (lead?.sid) {
          await recordBotFunnelEvent({
            leadSid: lead.sid,
            event: "conversation_held",
            eventKey: `conversation_held:ghl:${row.ghlMessageId}`,
            occurredAt: row.callStartedAt ?? new Date(),
            metadata: { durationSec: row.callDurationSec ?? null },
          });
        }
        done++;
        continue;
      }

      // Idempotency: if a previous run created the note but crashed before
      // updating `posted_back_at`, the marker is already in the contact's
      // note list — skip.
      const existing = await listContactNotes(row.ghlContactId);
      const marker = markerFor(row.ghlMessageId);
      const legacyMarker = legacyMarkerFor(row.ghlMessageId);
      const already = existing.find(
        (n) => (n.body ?? "").includes(marker) || (n.body ?? "").includes(legacyMarker),
      );
      if (already) {
        await db
          .update(callRecordingImports)
          .set({
            postedBackAt: new Date(),
            postedNoteId: already.id,
            status: "posted",
            updatedAt: new Date(),
          })
          .where(eq(callRecordingImports.id, row.id));
        const [lead] = await db
          .select({ sid: leads.manychatSubId })
          .from(leads)
          .where(eq(leads.ghlContactId, row.ghlContactId))
          .limit(1);
        if (lead?.sid) {
          await recordBotFunnelEvent({
            leadSid: lead.sid,
            event: "conversation_held",
            eventKey: `conversation_held:ghl:${row.ghlMessageId}`,
            occurredAt: row.callStartedAt ?? new Date(),
            metadata: { durationSec: row.callDurationSec ?? null },
          });
        }
        done++;
        continue;
      }

      const body = buildCallAnalysisNote({
        marker: markerFor(row.ghlMessageId),
        sourceLabel: "שיחת GHL",
        startedAt: row.callStartedAt,
        durationSec: row.callDurationSec,
        analysis,
        transcript: row.transcript ?? "",
        settings,
      });
      const { id: noteId } = await addContactNote(row.ghlContactId, body);

      await db
        .update(callRecordingImports)
        .set({
          postedBackAt: new Date(),
          postedNoteId: noteId,
          status: "posted",
          updatedAt: new Date(),
        })
        .where(eq(callRecordingImports.id, row.id));
      const [lead] = await db
        .select({ sid: leads.manychatSubId })
        .from(leads)
        .where(eq(leads.ghlContactId, row.ghlContactId))
        .limit(1);
      if (lead?.sid) {
        await recordBotFunnelEvent({
          leadSid: lead.sid,
          event: "conversation_held",
          eventKey: `conversation_held:ghl:${row.ghlMessageId}`,
          occurredAt: row.callStartedAt ?? new Date(),
          metadata: { durationSec: row.callDurationSec ?? null },
        });
      }
      done++;
    } catch (err) {
      await recordError(row.id, err, row.attempts + 1 >= MAX_ATTEMPTS);
    }
  }
  return { done };
}

// ===========================================================================
// Handler.
// ===========================================================================
const run = withJob("process-recordings", "calls", async (req: NextRequest, log) => {
  if (!authorized(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  const discovered = await stage1Discover().catch((e) => {
    log.error("discover.failed", e, { stage: "discover" });
    return { inserted: 0, scanned: 0, error: String(e) };
  });
  const transcribed = await stage2Transcribe().catch((e) => {
    log.error("transcribe.failed", e, { stage: "transcribe" });
    return { done: 0, error: String(e) };
  });
  const analyzed = await stage3Analyze().catch((e) => {
    log.error("analyze.failed", e, { stage: "analyze" });
    return { done: 0, error: String(e) };
  });
  const posted = await stage4PostBack().catch((e) => {
    log.error("post_back.failed", e, { stage: "post_back" });
    return { done: 0, error: String(e) };
  });

  // Piggyback the ElevenLabs→GHL call sync on this same every-5-min Cloud
  // Routine (the claude.ai scheduler for a dedicated routine was unavailable).
  // ADDITIVE + non-fatal: wrapped so it can never affect the recording
  // pipeline above. The standalone /api/elevenlabs/sync-calls route stays for
  // manual triggering and can later move to its own routine.
  let elevenlabs: unknown = { skipped: true };
  try {
    const base =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "https://albadi-crm.vercel.app");
    const secret = process.env.BOT_SECRET ?? process.env.CALL_TRIGGER_SECRET ?? "";
    const r = await fetch(`${base}/api/elevenlabs/sync-calls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    elevenlabs = await r.json().catch(() => ({ ok: r.ok, status: r.status }));
  } catch (e) {
    log.warn("elevenlabs.piggyback_failed", { ...serializeError(e) });
    elevenlabs = { ok: false, error: String(e) };
  }

  // Piggyback factory-quote refresh on the same every-5-min routine. Vercel
  // Hobby doesn't allow sub-daily crons, so this is how a factory completing
  // a Feishu row (price → dims → weight) gets picked up within 5 min instead
  // of waiting for someone to click "🔄 רענן" in the dashboard.
  // ADDITIVE + non-fatal: never blocks the recording pipeline.
  let factory: unknown = { skipped: true };
  try {
    const { refreshFromFeishu } = await import("@/lib/factory/server/refresh");
    factory = await refreshFromFeishu();
  } catch (e) {
    log.warn("factory_refresh.piggyback_failed", { ...serializeError(e) });
    factory = { ok: false, error: String(e) };
  }

  // The per-tick summary — this is how a dead cron gets noticed.
  log.info("tick.summary", {
    scanned: discovered.scanned,
    inserted: discovered.inserted,
    transcribed: transcribed.done,
    analyzed: analyzed.done,
    posted: posted.done,
    duration_ms: Date.now() - startedAt,
  });

  return NextResponse.json({
    elapsedMs: Date.now() - startedAt,
    discovered,
    transcribed,
    analyzed,
    posted,
    elevenlabs,
    factory,
  });
});

export const POST = run;
// Allow GET for the same handler so the Cloud Routine doesn't need a body.
export const GET = run;

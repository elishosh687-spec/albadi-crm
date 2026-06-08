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
import { appConfig, callRecordingImports } from "@/drizzle/schema";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  addContactNote,
  downloadRecording,
  listContactNotes,
  searchCallMessages,
} from "@/integrations/ghl/client";
import { transcribeAudio, TranscribeError } from "@/lib/transcription/whisper";
import {
  analyzeCall,
  type CallAnalysis,
} from "@/lib/autoresponder/call-analysis";

export const runtime = "nodejs";
export const maxDuration = 300;

const CURSOR_KEY = "call_recordings.last_polled_at";
const CURSOR_OVERLAP_MS = 30 * 60 * 1000; // 30min belt-and-suspenders rewind
const MAX_PER_TICK_DOWNLOADS = 5;
const MAX_ATTEMPTS = 3;
const NOTE_MARKER_VERSION = "CALL-ANALYSIS v1";

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

function formatHebrewNote(args: {
  messageId: string;
  startedAt: Date | null;
  durationSec: number | null;
  analysis: CallAnalysis;
  transcript: string;
}): string {
  const { messageId, startedAt, durationSec, analysis, transcript } = args;

  const dateStr = startedAt
    ? `${startedAt.toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "—";
  const minStr = durationSec
    ? `${Math.round(durationSec / 60)}m`
    : "—";

  const bullets = (xs: string[]) =>
    xs.length === 0 ? "—" : xs.map((x) => `• ${x}`).join("\n");
  const objBullets =
    analysis.objections.length === 0
      ? "—"
      : analysis.objections
          .map((o) =>
            o.quote
              ? `• ${o.text}  ("${o.quote}")`
              : `• ${o.text}`,
          )
          .join("\n");

  return [
    markerFor(messageId),
    `📞 שיחה: ${dateStr} · ${minStr}`,
    "",
    `🧭 סיכום: ${analysis.call_summary || "—"}`,
    "",
    `🎯 צרכי לקוח:`,
    bullets(analysis.customer_needs),
    "",
    `⚠️ התנגדויות:`,
    objBullets,
    "",
    `💰 מחיר: ${analysis.price_discussion ?? "—"}`,
    "",
    `➡️ צעדים הבאים:`,
    bullets(analysis.next_steps),
    "",
    `רגש: ${analysis.sentiment}  ·  דחיפות מעקב: ${analysis.follow_up_urgency}`,
    analysis.competitor_mentions.length > 0
      ? `מתחרים שהוזכרו: ${analysis.competitor_mentions.join(", ")}`
      : "",
    analysis.red_flags.length > 0
      ? `🚩 דגלים אדומים: ${analysis.red_flags.join(", ")}`
      : "",
    "",
    "📄 תמלול:",
    transcript,
  ]
    .filter((s) => s !== "")
    .join("\n");
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

  for (const c of calls) {
    // Skip non-completed calls (voicemail/busy/etc. produce no useful audio
    // OR get a separate code path later).
    const status = c.meta?.call?.status;
    if (status && status !== "completed") continue;

    // Skip very-recently-added rows — GHL sometimes lags attaching the
    // recording binary to the message for ~60s after the call ends.
    if (c.dateAdded) {
      const age = Date.now() - new Date(c.dateAdded).getTime();
      if (age < 60_000) continue;
      newestSeen.push(new Date(c.dateAdded));
    }

    try {
      await db.insert(callRecordingImports).values({
        ghlMessageId: c.id,
        ghlContactId: c.contactId ?? "",
        ghlConversationId: c.conversationId,
        callDurationSec: c.meta?.call?.duration ?? null,
        callStartedAt: c.dateAdded ? new Date(c.dateAdded) : null,
        recordingUrl: c.meta?.call?.recordingUrl ?? null,
        status: "pending",
      });
      inserted++;
    } catch (e) {
      // Likely unique violation on ghl_message_id — that's the dedupe path.
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("duplicate") && !msg.includes("unique")) {
        console.error(`[process-recordings] insert failed for ${c.id}:`, msg);
      }
    }
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
        sql`${callRecordingImports.status} not in ('failed','skipped_oversize','skipped_voicemail')`,
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
  const rows = await db
    .select()
    .from(callRecordingImports)
    .where(
      and(
        isNotNull(callRecordingImports.transcript),
        isNull(callRecordingImports.analyzedAt),
        sql`${callRecordingImports.status} not in ('failed','skipped_oversize','skipped_voicemail')`,
        lte(callRecordingImports.attempts, MAX_ATTEMPTS),
      ),
    )
    .limit(MAX_PER_TICK_DOWNLOADS);

  let done = 0;
  for (const row of rows) {
    try {
      const analysis = await analyzeCall(row.transcript ?? "");
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
async function stage4PostBack(): Promise<{ done: number }> {
  const rows = await db
    .select()
    .from(callRecordingImports)
    .where(
      and(
        isNotNull(callRecordingImports.analyzedAt),
        isNull(callRecordingImports.postedBackAt),
        sql`${callRecordingImports.status} not in ('failed','skipped_oversize','skipped_voicemail')`,
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
      // Idempotency: if a previous run created the note but crashed before
      // updating `posted_back_at`, the marker is already in the contact's
      // note list — skip.
      const existing = await listContactNotes(row.ghlContactId);
      const marker = markerFor(row.ghlMessageId);
      const already = existing.find((n) => (n.body ?? "").includes(marker));
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
        done++;
        continue;
      }

      const body = formatHebrewNote({
        messageId: row.ghlMessageId,
        startedAt: row.callStartedAt,
        durationSec: row.callDurationSec,
        analysis: row.analysis as CallAnalysis,
        transcript: row.transcript ?? "",
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
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  const discovered = await stage1Discover().catch((e) => {
    console.error("[process-recordings] stage1 failed", e);
    return { inserted: 0, scanned: 0, error: String(e) };
  });
  const transcribed = await stage2Transcribe().catch((e) => {
    console.error("[process-recordings] stage2 failed", e);
    return { done: 0, error: String(e) };
  });
  const analyzed = await stage3Analyze().catch((e) => {
    console.error("[process-recordings] stage3 failed", e);
    return { done: 0, error: String(e) };
  });
  const posted = await stage4PostBack().catch((e) => {
    console.error("[process-recordings] stage4 failed", e);
    return { done: 0, error: String(e) };
  });

  return NextResponse.json({
    elapsedMs: Date.now() - startedAt,
    discovered,
    transcribed,
    analyzed,
    posted,
  });
}

// Allow GET for the same handler so the Cloud Routine doesn't need a body.
export async function GET(req: NextRequest) {
  return POST(req);
}

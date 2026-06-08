/**
 * Thin OpenAI Whisper (audio transcription) wrapper.
 *
 * Mirrors the design of [lib/autoresponder/openai-client.ts](../autoresponder/openai-client.ts):
 *   - Honors OPENAI_API_KEY (required) + OPENAI_TRANSCRIBE_MODEL (defaults to whisper-1).
 *   - Multipart form POST to /v1/audio/transcriptions.
 *   - **Throws** on any failure — callers (the cron) wrap in try/catch and
 *     persist the error on the row. We intentionally do NOT soft-fail to
 *     null here, because the cron's state machine needs to distinguish
 *     "transcription not attempted" from "transcription failed with reason".
 *
 * The OpenAI audio API has a hard 25MB file size limit across all current
 * models (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe). Callers
 * MUST size-check before invoking — see TranscribeError.kind === "too_large".
 */

const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-1";
const MAX_BYTES = 25 * 1024 * 1024; // OpenAI hard limit
const DEFAULT_TIMEOUT_MS = 120_000; // long audio + slow networks

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export interface TranscribeOptions {
  /** Used as the filename hint OpenAI sees in the multipart form. The extension hints content type — pass ".mp3", ".wav", ".m4a", etc. Defaults to "audio.mp3". */
  filename?: string;
  /** MIME type for the multipart blob. Defaults to "audio/mpeg". */
  contentType?: string;
  /** Override the model env var. */
  model?: string;
  /** ISO 639-1 language code hint. Omit to let Whisper auto-detect (best for Hebrew+English mixed calls). */
  language?: string;
  /** Default 120s. Long calls take longer. */
  timeoutMs?: number;
}

export class TranscribeError extends Error {
  constructor(
    public kind: "no_api_key" | "too_large" | "non_2xx" | "network" | "timeout",
    message: string,
    public status?: number,
    public detail?: string,
  ) {
    super(message);
    this.name = "TranscribeError";
  }
}

/**
 * Transcribe an audio buffer via OpenAI. Returns the raw transcript string.
 * Throws TranscribeError on any failure — see kind for classification.
 */
export async function transcribeAudio(
  audio: Buffer,
  opts: TranscribeOptions = {},
): Promise<string> {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    throw new TranscribeError("no_api_key", "OPENAI_API_KEY is not set");
  }
  if (audio.byteLength > MAX_BYTES) {
    throw new TranscribeError(
      "too_large",
      `audio is ${audio.byteLength} bytes, exceeds OpenAI 25MB limit`,
    );
  }

  // `||` not `??`: readEnv returns "" for unset, and "" must fall back too.
  const model = opts.model || readEnv("OPENAI_TRANSCRIBE_MODEL") || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const contentType = opts.contentType ?? "audio/mpeg";
  // Whisper inspects the filename extension to detect audio format. If the
  // extension doesn't match the content type, it returns 400. Derive a
  // matching extension when the caller hasn't been explicit.
  const filename =
    opts.filename ??
    `audio.${
      contentType.includes("wav")
        ? "wav"
        : contentType.includes("ogg")
          ? "ogg"
          : contentType.includes("webm")
            ? "webm"
            : contentType.includes("m4a") || contentType.includes("mp4")
              ? "m4a"
              : "mp3"
    }`;

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: contentType }), filename);
  form.append("model", model);
  // verbose_json gives us text + segments + language; for now we only use text,
  // but it's the same cost and gives diagnostics if we ever want them.
  form.append("response_format", "verbose_json");
  if (opts.language) form.append("language", opts.language);

  const controller = new AbortController();
  let abortedByTimeout = false;
  const timer = setTimeout(() => {
    abortedByTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new TranscribeError(
        "non_2xx",
        `OpenAI transcription failed: ${res.status}`,
        res.status,
        detail.slice(0, 500),
      );
    }
    const data = (await res.json()) as { text?: string };
    if (!data.text) {
      throw new TranscribeError("non_2xx", "OpenAI returned no text", res.status);
    }
    return data.text;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof TranscribeError) throw err;
    if (abortedByTimeout) {
      throw new TranscribeError("timeout", `transcription exceeded ${timeoutMs}ms`);
    }
    throw new TranscribeError(
      "network",
      err instanceof Error ? err.message : String(err),
    );
  }
}

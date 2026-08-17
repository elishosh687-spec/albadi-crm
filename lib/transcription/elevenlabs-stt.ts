/**
 * Transcription with SPEAKER SEPARATION, via ElevenLabs Scribe.
 *
 * No OpenAI transcription model does diarization — not whisper-1, not the
 * gpt-4o-transcribe family. Picking a "more accurate" one there buys better
 * word recognition and nothing else, so a two-party sales call comes back as
 * one undifferentiated wall of text and the analyst downstream has to guess
 * who objected and who conceded.
 *
 * Scribe returns per-word speaker ids, which we fold back into a labelled
 * transcript. Two side benefits worth knowing: it accepts far larger files
 * than Whisper's 25MB ceiling (which is what currently sends long calls to
 * `skipped_oversize`), and it reuses the ElevenLabs key already in production
 * for the voice agent — no new vendor, no new billing relationship.
 */
import { readEnv } from "./whisper";

const XI_STT = "https://api.elevenlabs.io/v1/speech-to-text";
const DEFAULT_MODEL = "scribe_v1";
/** Scribe accepts ~1GB; this is a sanity bound, not the API's limit. */
const MAX_BYTES = 200 * 1024 * 1024;

export class ScribeError extends Error {
  constructor(
    public code: "no_api_key" | "too_large" | "http" | "empty" | "timeout",
    message: string
  ) {
    super(message);
    this.name = "ScribeError";
  }
}

interface ScribeWord {
  text?: string;
  type?: string;
  speaker_id?: string;
}

interface ScribeResponse {
  text?: string;
  language_code?: string;
  words?: ScribeWord[];
}

/**
 * Fold per-word speaker ids into readable turns.
 *
 * Falls back to the flat text when diarization produced a single speaker or no
 * word data — a transcript labelled "דובר 1:" from end to end is noise, not
 * information.
 */
export function buildDiarizedTranscript(res: ScribeResponse): string {
  const words = res.words ?? [];
  const speakers = new Set(
    words.map((w) => w.speaker_id).filter((x): x is string => !!x)
  );
  if (words.length === 0 || speakers.size < 2) return (res.text ?? "").trim();

  // Stable, readable labels: first voice heard becomes דובר 1.
  const order: string[] = [];
  const label = (id: string) => {
    if (!order.includes(id)) order.push(id);
    return `דובר ${order.indexOf(id) + 1}`;
  };

  const turns: string[] = [];
  let currentId: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentId && buffer.length) {
      const line = buffer.join("").replace(/\s+/g, " ").trim();
      if (line) turns.push(`${label(currentId)}: ${line}`);
    }
    buffer = [];
  };

  for (const w of words) {
    if (w.type && w.type !== "word" && w.type !== "spacing") continue;
    const id: string = w.speaker_id ?? currentId ?? "unknown";
    if (id !== currentId) {
      flush();
      currentId = id;
    }
    buffer.push(w.text ?? "");
  }
  flush();

  return turns.join("\n").trim() || (res.text ?? "").trim();
}

export async function transcribeWithScribe(
  audio: ArrayBuffer,
  opts: {
    filename?: string;
    contentType?: string;
    timeoutMs?: number;
    /** ISO-639-1/3. Omitted = auto-detect, which handles Hebrew/English mixing. */
    languageCode?: string;
  } = {}
): Promise<string> {
  const apiKey = readEnv("ELEVENLABS_API_KEY");
  if (!apiKey) {
    throw new ScribeError("no_api_key", "ELEVENLABS_API_KEY is not set");
  }
  if (audio.byteLength > MAX_BYTES) {
    throw new ScribeError("too_large", `audio is ${audio.byteLength} bytes`);
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([audio], { type: opts.contentType ?? "audio/mpeg" }),
    opts.filename ?? "audio.mp3"
  );
  form.append("model_id", DEFAULT_MODEL);
  form.append("diarize", "true");
  // Sound events ("[laughter]") add noise to a sales transcript.
  form.append("tag_audio_events", "false");
  if (opts.languageCode) form.append("language_code", opts.languageCode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  try {
    const res = await fetch(XI_STT, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ScribeError("http", `scribe ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as ScribeResponse;
    const text = buildDiarizedTranscript(json);
    if (!text) throw new ScribeError("empty", "scribe returned no text");
    return text;
  } catch (e) {
    if (e instanceof ScribeError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new ScribeError("timeout", "scribe timed out");
    }
    throw new ScribeError("http", (e as Error)?.message ?? String(e));
  } finally {
    clearTimeout(timer);
  }
}

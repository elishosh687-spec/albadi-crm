/**
 * ElevenLabs Conversational AI — minimal read client for the GHL bridge.
 *
 * We POLL conversations (mirrors the GHL call-recording cron) rather than
 * relying on a post-call webhook, so the bridge needs no webhook/secret
 * config and can be tested against existing conversations immediately.
 *
 * Auth: `ELEVENLABS_API_KEY` (xi-api-key header). Read-only here.
 */

const XI_BASE = "https://api.elevenlabs.io/v1";

export function elevenLabsKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not set");
  return k;
}

async function xiFetch<T>(
  path: string,
  query?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`${XI_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const res = await fetch(url, {
    headers: { "xi-api-key": elevenLabsKey(), Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface ElevenConversationSummary {
  conversation_id: string;
  agent_id: string;
  agent_name?: string;
  start_time_unix_secs?: number;
  call_duration_secs?: number;
  message_count?: number;
  status?: string;
  direction?: string | null;
  call_summary_title?: string | null;
}

export interface ElevenTranscriptTurn {
  role: "agent" | "user" | string;
  message: string | null;
  time_in_call_secs?: number;
}

export interface ElevenConversationDetail {
  conversation_id: string;
  agent_id: string;
  status?: string;
  transcript?: ElevenTranscriptTurn[];
  has_audio?: boolean;
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    phone_call?: {
      direction?: string;
      external_number?: string;
      agent_number?: string;
      type?: string;
    } | null;
  };
  analysis?: {
    transcript_summary?: string | null;
    call_summary_title?: string | null;
  } | null;
}

/**
 * List recent conversations, optionally scoped to one agent. ElevenLabs
 * returns newest-first. `callStartAfterUnix` filters to calls that started
 * after the given epoch-seconds cursor.
 */
export async function listConversations(opts: {
  agentId?: string;
  pageSize?: number;
  callStartAfterUnix?: number;
}): Promise<ElevenConversationSummary[]> {
  const res = await xiFetch<{ conversations: ElevenConversationSummary[] }>(
    "/convai/conversations",
    {
      agent_id: opts.agentId,
      page_size: opts.pageSize ?? 30,
      call_start_after_unix: opts.callStartAfterUnix,
    }
  );
  return res.conversations ?? [];
}

export async function getConversation(
  conversationId: string
): Promise<ElevenConversationDetail> {
  return xiFetch<ElevenConversationDetail>(
    `/convai/conversations/${conversationId}`
  );
}

/**
 * Build a plain-text transcript for analysis + the GHL note. Maps ElevenLabs
 * roles to Hebrew labels matching the GHL-native call pipeline's framing
 * (agent = sales rep, user = customer).
 */
export function buildTranscriptText(detail: ElevenConversationDetail): string {
  const turns = detail.transcript ?? [];
  return turns
    .filter((t) => (t.message ?? "").trim().length > 0)
    .map((t) => {
      const who = t.role === "user" ? "לקוח" : "נציג";
      return `${who}: ${(t.message ?? "").trim()}`;
    })
    .join("\n");
}

export interface ElevenCallMeta {
  phone: string | null;
  direction: string | null;
  durationSec: number | null;
  startedAt: Date | null;
  summary: string | null;
}

export function extractCallMeta(detail: ElevenConversationDetail): ElevenCallMeta {
  const pc = detail.metadata?.phone_call ?? null;
  const startUnix = detail.metadata?.start_time_unix_secs;
  return {
    phone: pc?.external_number?.trim() || null,
    direction: pc?.direction ?? null,
    durationSec: detail.metadata?.call_duration_secs ?? null,
    startedAt: startUnix ? new Date(startUnix * 1000) : null,
    summary: detail.analysis?.transcript_summary?.trim() || null,
  };
}

/**
 * Public proxy URL for a conversation's recording, ending in `.mp3` so GHL's
 * /medias/upload-file whitelist accepts it. The proxy injects the xi-api-key
 * server-side (the raw ElevenLabs audio endpoint requires it). The
 * conversation id is the only "secret" in the path — same model as the
 * existing media proxy at /api/integrations/media.
 */
export function recordingProxyUrl(conversationId: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "https://albadi-crm.vercel.app";
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}/api/elevenlabs/recording/${encodeURIComponent(conversationId)}.mp3`;
}

/** Server-side fetch of the raw conversation audio (MP3 bytes). */
export async function fetchConversationAudio(
  conversationId: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(
    `${XI_BASE}/convai/conversations/${conversationId}/audio`,
    { headers: { "xi-api-key": elevenLabsKey() } }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs audio ${conversationId} → ${res.status} ${body.slice(0, 200)}`
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "audio/mpeg";
  return { buffer, contentType };
}

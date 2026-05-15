/**
 * Thin OpenAI Chat Completions wrapper. Shared by intent classifier, spec
 * extractor, unmatch agent, and any other Albadi LLM call.
 *
 * Design:
 *   - Soft-fails on any error (returns null). Callers MUST handle null and
 *     fall back to the deterministic path. This keeps a flaky API from
 *     blocking the webhook or the questionnaire.
 *   - JSON mode by default (response_format: json_object). Pass jsonMode=false
 *     for free-text replies.
 *   - Single retry on 5xx / network / empty / non-JSON. No retry on 4xx.
 *   - Honors OPENAI_MODEL env var (defaults to gpt-4o-mini).
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MODEL = "gpt-4o-mini";

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export interface CallLLMInput {
  system: string;
  user: string;
  model?: string;
  /** Default true — sets response_format json_object and JSON.parses the reply. */
  jsonMode?: boolean;
  /** Default 0. */
  temperature?: number;
  /** Default 10000ms. */
  timeoutMs?: number;
  /** Default 1 (so up to 2 attempts total). */
  retries?: number;
}

export interface CallLLMError {
  kind: "no_api_key" | "non_2xx" | "empty" | "non_json" | "network" | "abort";
  detail?: string;
  status?: number;
}

/**
 * Returns parsed JSON (if jsonMode) or raw string. Returns null on any failure.
 * Logs the failure to console.error so we can grep production logs.
 */
export async function callLLM<T = unknown>(input: CallLLMInput): Promise<T | null> {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    console.warn("[openai-client] OPENAI_API_KEY missing — returning null");
    return null;
  }
  const model = input.model ?? (readEnv("OPENAI_MODEL") || DEFAULT_MODEL);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = input.retries ?? 1;
  const jsonMode = input.jsonMode ?? true;
  const temperature = input.temperature ?? 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let abortedBy: "timeout" | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      abortedBy = "timeout";
      controller.abort();
    }, timeoutMs);

    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const txt = await res.text();
        console.error(
          `[openai-client] non-2xx ${res.status} (attempt ${attempt + 1}/${maxRetries + 1})`,
          txt.slice(0, 200)
        );
        // Retry on 5xx; fail fast on 4xx.
        if (res.status >= 500 && attempt < maxRetries) continue;
        return null;
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) {
        console.error(`[openai-client] empty response (attempt ${attempt + 1})`);
        if (attempt < maxRetries) continue;
        return null;
      }

      if (!jsonMode) {
        return raw as unknown as T;
      }

      try {
        return JSON.parse(raw) as T;
      } catch {
        console.error(
          `[openai-client] non-JSON response (attempt ${attempt + 1})`,
          raw.slice(0, 200)
        );
        if (attempt < maxRetries) continue;
        return null;
      }
    } catch (e) {
      clearTimeout(timer);
      const reason = abortedBy === "timeout" ? "timeout" : "network";
      console.error(
        `[openai-client] ${reason} (attempt ${attempt + 1}/${maxRetries + 1})`,
        e instanceof Error ? e.message : e
      );
      if (attempt < maxRetries) continue;
      return null;
    }
  }
  return null;
}

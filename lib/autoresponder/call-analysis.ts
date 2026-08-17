/**
 * Sales-call analysis. Takes a Hebrew transcript and returns structured
 * insights — customer needs, objections, price discussion, next steps,
 * sentiment, urgency, red flags.
 *
 * Used by [/api/bot/process-recordings] after Whisper transcribes the call
 * recording. The structured output is stored in `call_recording_imports.analysis`
 * and then formatted into a Hebrew note posted to the GHL contact.
 *
 * Soft-fail contract: returns null on any LLM failure (mirrors callLLM).
 * Callers should mark the row as failed and let the cron retry on next tick.
 */
import { callLLM } from "./openai-client";
import { getBotSettings } from "../bot-settings/store";

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export interface CallAnalysisObjection {
  text: string;
  quote?: string;
}

export interface CallAnalysis {
  /** 1-2 sentence summary of what happened. */
  call_summary: string;
  /** What the customer was looking for. */
  customer_needs: string[];
  /** Objections raised by the customer. */
  objections: CallAnalysisObjection[];
  /** What was said about price, or null if not discussed. */
  price_discussion: string | null;
  /** Competitor names mentioned. */
  competitor_mentions: string[];
  /** Steps explicitly agreed on during the call. */
  next_steps: string[];
  sentiment: "positive" | "neutral" | "negative";
  /** Concrete buying signals (asked about shipping, dates, MOQ, etc.). */
  buying_signals: string[];
  follow_up_urgency: "low" | "medium" | "high";
  /** Red flags — e.g. customer already signed with a competitor. */
  red_flags: string[];
  /**
   * Absolute ISO-8601 instant the customer agreed to be called back, or null.
   * Computed by the LLM relative to the call-start anchor. Drives the
   * auto-created GHL "callback" task. See docs/SALESPERSON-WORKFLOW.md.
   */
  callback_at: string | null;
  /** Short Hebrew phrase describing the callback ask, or null. */
  callback_reason: string | null;
}

/**
 * What the analyst is asked to look for — Eli's to change.
 *
 * The prompt splits in two on purpose. THIS half is business judgement: what
 * counts as an objection, how to treat a voicemail, how to resolve "call me
 * tomorrow" into a real time. It moves to the settings screen so refining what
 * a call summary contains stops requiring a developer.
 *
 * The JSON schema below does NOT move. It is a machine contract: every field
 * is read by name downstream — the note builder, the callback task, the
 * setter's dossier. An edited schema would not degrade the analysis, it would
 * end it, silently, for every call.
 */
import { DEFAULT_CALL_ANALYSIS_GUIDANCE } from "../bot-settings/analysis-defaults";
export { DEFAULT_CALL_ANALYSIS_GUIDANCE };

/** The machine contract. Not configurable — see above. */
const RESPONSE_SCHEMA = `החזר JSON בדיוק בפורמט הבא:
{
  "call_summary": "1-2 משפטים על מה קרה בשיחה",
  "customer_needs": ["..."],
  "objections": [{"text":"...", "quote":"..."}],
  "price_discussion": "מה נאמר על מחיר, או null",
  "competitor_mentions": ["..."],
  "next_steps": ["סוכם ש..."],
  "sentiment": "positive" | "neutral" | "negative",
  "buying_signals": ["..."],
  "follow_up_urgency": "low" | "medium" | "high",
  "red_flags": ["..."],
  "callback_at": "ISO 8601 עם offset ישראל אם סוכם מועד חזרה, אחרת null",
  "callback_reason": "משפט קצר בעברית על מה סוכם לגבי החזרה, אחרת null"
}`;

async function buildSystemPrompt(): Promise<string> {
  let guidance = DEFAULT_CALL_ANALYSIS_GUIDANCE;
  try {
    const { getBotSettings } = await import("../bot-settings/store");
    const custom = (await getBotSettings()).callAnalysisGuidance?.trim();
    if (custom) guidance = custom;
  } catch {
    /* settings unavailable — the default guidance still analyses correctly */
  }
  return `${guidance}\n\n${RESPONSE_SCHEMA}`;
}

/** Format the call-start anchor for the prompt, in Israel local time. */
function jerusalemAnchor(at: Date): string {
  return at.toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Keep a callback only if it's a sane instant (not garbage, not far past/future). */
function sanitizeCallbackAt(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;
  // Reject obvious hallucinations: more than 2 days in the past (a callback
  // that already long elapsed) or more than 60 days out. Recent past is fine —
  // clampToWorkWindow pulls it up to the next valid slot.
  if (d.getTime() < now - TWO_DAYS || d.getTime() > now + SIXTY_DAYS) return null;
  return d.toISOString();
}

/**
 * Analyze a call transcript. Returns null on any LLM/parse failure.
 *
 * @param transcript Raw transcript text (Hebrew, possibly with English mixed in).
 * @param opts.callStartedAt When the call happened — the anchor the LLM uses to
 *   turn "in 2 hours" / "tomorrow at 9" into an absolute `callback_at`. Falls
 *   back to now if unknown (less accurate for delayed processing).
 */
export async function analyzeCall(
  transcript: string,
  opts?: { callStartedAt?: Date | null },
): Promise<CallAnalysis | null> {
  if (!transcript || transcript.trim().length === 0) return null;

  // Analysing a call IS analysis, so it follows the "מודל ניתוח" setting like
  // the lead analyser does. Before this it read only the env var — which is
  // unset in production — and fell through to the CONVERSATION model, the
  // cheapest one in the list. Nobody chose that; the settings screen simply
  // had no effect here, which made the control a lie.
  const model =
    readEnv("OPENAI_ANALYSIS_MODEL") ||
    (await getBotSettings()
      .then((s) => s.analysisModel)
      .catch(() => undefined));

  const anchor = opts?.callStartedAt ?? new Date();
  const user = [
    `זמן תחילת השיחה (אזור זמן ישראל): ${jerusalemAnchor(anchor)}`,
    `ISO: ${anchor.toISOString()}`,
    "",
    `תמלול השיחה:`,
    "",
    transcript,
  ].join("\n");

  const result = await callLLM<CallAnalysis>({
    system: await buildSystemPrompt(),
    user,
    model,
    jsonMode: true,
    // Longer timeout — analysis on a 30-min transcript can take ~10-20s.
    timeoutMs: 60_000,
  });

  if (!result) return null;

  // Defensive: coerce missing array fields to [] so downstream formatting
  // doesn't crash on .map() of undefined. The model usually returns the
  // right shape but JSON-mode + Hebrew prompts occasionally drop fields.
  return {
    call_summary: result.call_summary ?? "",
    customer_needs: result.customer_needs ?? [],
    objections: result.objections ?? [],
    price_discussion: result.price_discussion ?? null,
    competitor_mentions: result.competitor_mentions ?? [],
    next_steps: result.next_steps ?? [],
    sentiment: result.sentiment ?? "neutral",
    buying_signals: result.buying_signals ?? [],
    follow_up_urgency: result.follow_up_urgency ?? "low",
    red_flags: result.red_flags ?? [],
    callback_at: sanitizeCallbackAt(result.callback_at),
    callback_reason: result.callback_reason ?? null,
  };
}

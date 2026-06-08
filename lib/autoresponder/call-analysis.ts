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
}

const SYSTEM_PROMPT = `אתה אנליסט שיחות מכירה לחברת אלבדי (אריזות + שקיות ממותגות).
מקבל תמלול של שיחה בין נציג מכירות לבין לקוח פוטנציאלי.

חוקים:
- כל מה שאתה לא בטוח בו - שים null או רשימה ריקה. אל תמציא.
- ציטוטים קצרים מהשיחה (עד 10 מילים) רק כשתומך בטענה.
- עברית בלבד בכל השדות הטקסטואליים.
- אם השיחה היא תא קולי או שיחה קצרה מאוד (פחות מ-20 מילים), החזר call_summary בלבד ושאר השדות ריקים.

החזר JSON בדיוק בפורמט הבא:
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
  "red_flags": ["..."]
}`;

/**
 * Analyze a call transcript. Returns null on any LLM/parse failure.
 *
 * @param transcript Raw transcript text (Hebrew, possibly with English mixed in).
 */
export async function analyzeCall(transcript: string): Promise<CallAnalysis | null> {
  if (!transcript || transcript.trim().length === 0) return null;

  const model = readEnv("OPENAI_ANALYSIS_MODEL") || undefined;

  const result = await callLLM<CallAnalysis>({
    system: SYSTEM_PROMPT,
    user: `תמלול השיחה:\n\n${transcript}`,
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
  };
}

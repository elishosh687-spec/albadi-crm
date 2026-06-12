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
  /**
   * Absolute ISO-8601 instant the customer agreed to be called back, or null.
   * Computed by the LLM relative to the call-start anchor. Drives the
   * auto-created GHL "callback" task. See docs/SALESPERSON-WORKFLOW.md.
   */
  callback_at: string | null;
  /** Short Hebrew phrase describing the callback ask, or null. */
  callback_reason: string | null;
}

const SYSTEM_PROMPT = `אתה אנליסט שיחות מכירה לחברת אלבדי (אריזות + שקיות ממותגות).
מקבל תמלול של שיחה בין נציג מכירות לבין לקוח פוטנציאלי.

חוקים:
- כל מה שאתה לא בטוח בו - שים null או רשימה ריקה. אל תמציא.
- ציטוטים קצרים מהשיחה (עד 10 מילים) רק כשתומך בטענה.
- עברית בלבד בכל השדות הטקסטואליים.
- אם השיחה היא תא קולי או שיחה קצרה מאוד (פחות מ-20 מילים), החזר call_summary בלבד ושאר השדות ריקים.

חוקי callback (מתי לחזור ללקוח):
- אם בשיחה סוכם שנחזור ללקוח (או שהלקוח ביקש שנחזור) במועד כלשהו — חשב את המועד המוחלט ביחס ל"זמן תחילת השיחה" שמופיע למעלה, והחזר אותו ב-callback_at בפורמט ISO 8601 עם אזור זמן ישראל (למשל "2026-06-12T16:30:00+03:00").
- "בעוד שעה/שעתיים/X דקות" → חשב מזמן תחילת השיחה. "מחר" בלי שעה → 09:00. "ביום ראשון" → 09:00 באותו יום.
- אם המועד מעורפל ואי אפשר לחשב שעה ("בהמשך", "מתישהו", "כשיתפנה", "אחר כך") → callback_at = null.
- אם לא סוכמה חזרה בכלל → callback_at = null וגם callback_reason = null.

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
  "red_flags": ["..."],
  "callback_at": "ISO 8601 עם offset ישראל אם סוכם מועד חזרה, אחרת null",
  "callback_reason": "משפט קצר בעברית על מה סוכם לגבי החזרה, אחרת null"
}`;

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

  const model = readEnv("OPENAI_ANALYSIS_MODEL") || undefined;

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
    system: SYSTEM_PROMPT,
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

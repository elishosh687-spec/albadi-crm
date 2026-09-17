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
import type { CallAnalysisV2 } from "../calls/analysis-v2";
import { normalizeCallAnalysisV2 } from "../calls/analysis-normalize";

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export type CallAnalysis = CallAnalysisV2;

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
const RESPONSE_SCHEMA = `החזר JSON בדיוק בפורמט הבא. אם מידע לא נאמר במפורש, החזר null, [] או "לא ידוע" — אל תנחש:
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
  "callback_reason": "משפט קצר בעברית על מה סוכם לגבי החזרה, אחרת null",
  "customer": {
    "whyNow": "למה הלקוח בודק עכשיו או null",
    "business": "מה העסק מוכר או null",
    "bagUse": "מה נכנס לשקית או null",
    "existingBagProblem": "מה לא עובד בשקית הקיימת או null",
    "priorSupplierExperience": "ניסיון קודם עם ספק או null",
    "requiredDate": "מועד/אירוע כפי שנאמר או null"
  },
  "needs": [{
    "need": "צורך אחד",
    "desiredOutcome": "תוצאה רצויה או null",
    "priority": "appearance|strength|size|price|deadline|other|unknown",
    "evidence": {"quote": "ציטוט מדויק וקצר מהתמלול או null"}
  }],
  "specification": {
    "quantity": null,
    "size": null,
    "colors": null,
    "details": [],
    "approved": null,
    "missing": [],
    "logoExists": null,
    "logoSent": null,
    "pricePresented": null,
    "fitsMinimumQuantity": null,
    "decisionMaker": null,
    "participants": []
  },
  "salespersonExecution": {
    "askedWhyNow": null,
    "exploredSeveralNeeds": null,
    "askedFollowUpBeforeSolution": null,
    "summarizedAndConfirmed": null,
    "tailoredRecommendation": null,
    "askedWhatBlocks": null,
    "askedForPaymentWhenReady": null,
    "agreedActionOwnerDue": null,
    "scoreOutOf10": null,
    "learningNotes": []
  },
  "objectionsV2": [{
    "type": "price|quantity|delivery_time|not_ready|trust|competitor|other|unknown",
    "customerWording": "ההתנגדות במילות הלקוח",
    "clarified": null,
    "handling": null,
    "resolution": "resolved|open|unclear",
    "nextStep": null,
    "evidence": {"quote": "ציטוט מדויק וקצר או null"}
  }],
  "outcome": {
    "result": "תוצאת השיחה",
    "advance": "התקדמות קונקרטית או null",
    "proposedAction": {
      "actionType": "callback|send_quote|send_sample|check_logo_received|check_payment|follow_up|factory_check|other",
      "description": "פעולה קונקרטית לנציג",
      "responsibleParty": "salesperson|customer|factory|unknown",
      "dueAt": "ISO 8601 עם offset ישראל או null",
      "dueText": "ניסוח המועד בשיחה או null",
      "confidence": 0.0,
      "evidence": {"quote": "ציטוט מדויק וקצר שמוכיח את הפעולה או null"}
    },
    "statusRecommendation": {
      "status": "negotiation|future_follow_up|won|lost|no_change",
      "reason": "סיבה קצרה",
      "confidence": 0.0,
      "evidence": {"quote": "ציטוט מדויק וקצר או null"}
    }
  },
  "isVoicemail": false,
  "isTooShortForAction": false
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
  const settings = await getBotSettings().catch(() => null);
  const model =
    readEnv("OPENAI_ANALYSIS_MODEL") ||
    settings?.analysisModel;

  const anchor = opts?.callStartedAt ?? new Date();
  const user = [
    `זמן תחילת השיחה (אזור זמן ישראל): ${jerusalemAnchor(anchor)}`,
    `ISO: ${anchor.toISOString()}`,
    "",
    `תמלול השיחה:`,
    "",
    transcript,
  ].join("\n");

  const result = await callLLM<Record<string, unknown>>({
    system: await buildSystemPrompt(),
    user,
    model,
    jsonMode: true,
    // Longer timeout — analysis on a 30-min transcript can take ~10-20s.
    timeoutMs: 60_000,
  });

  if (!result) return null;

  return normalizeCallAnalysisV2(result, {
    transcript,
    callStartedAt: anchor,
    model: model ?? null,
    guidanceRevision: settings?.callAnalysisGuidance?.trim() ? "custom-v2" : "default-v2",
    maxFutureDays: settings?.callAnalysisMaxFutureDays,
    minTranscriptChars: settings?.callAnalysisMinTranscriptChars,
  });
}

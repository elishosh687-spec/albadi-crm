/**
 * Bot Supervisor — gates every inbound message through an LLM before any
 * outbound action.
 *
 * Returns a verdict that the webhook caller routes:
 *   approve_code        → run the existing handler (it sends its own reply).
 *   override_with_text  → block the handler's reply, send the LLM's text;
 *                          still apply the handler's stage transition.
 *   escalate_to_eli     → block the handler, queue a draft + DM Eli.
 *   silence             → no send. Log only.
 *   supervisor_error    → LLM call failed; webhook DMs Eli, blocks send.
 *
 * Cost: one LLM call per inbound (~$0.002-0.005 with gpt-4o-mini-equivalent
 * tier). Langfuse tracing is added in a follow-up — column `langfuse_trace_id`
 * exists in bot_decision_log for the link.
 */
import type { CandidateAction } from "./candidate";
import { sendEliDM } from "../notify/eli";

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 12_000;

/**
 * Version tag for the supervisor system prompt. Bump this when you edit
 * SYSTEM_PROMPT below so the decision log can filter by prompt version and
 * replay past inbounds against any historical prompt (Phase 2 / 3).
 */
export const SUPERVISOR_PROMPT_VERSION = "supervisor-v1.0.0";

export type SupervisorRecommendation =
  | "approve_code"
  | "override_with_text"
  | "escalate_to_eli"
  | "silence"
  | "supervisor_error";

export interface SupervisorVerdict {
  recommended: SupervisorRecommendation;
  intent: string | null;
  confidence: number | null;
  reason: string;
  overrideText: string | null;
  riskFlags: string[];
  /** Raw LLM response for log / debugging. */
  rawJson: string | null;
  /** Prompt version used (for replay + A/B). */
  promptVersion: string;
  /** Model used (for replay + cost analysis). */
  model: string;
}

interface SuperviseInput {
  sid: string;
  jid: string;
  inboundText: string;
  stage: string | null;
  qState: any;
  recentMessages: { direction: "in" | "out"; text: string }[];
  leadName: string | null;
  phone: string | null;
  botPaused: boolean;
  candidate: CandidateAction;
}

const SYSTEM_PROMPT = `You are the SUPERVISOR layer of a WhatsApp sales bot for an Israeli printed-bag business (Albadi). Customers write in Hebrew. The bot has deterministic handlers that already produce canned answers for ~12 intents and escalate edge cases to the operator (Eli) via a draft queue.

Your job: gate EVERY inbound message. Look at the conversation, the current stage, what the existing handler is about to do (the "candidate" action), and decide one of:

1) "approve_code" — the candidate action is appropriate. Existing handler runs and sends its reply.
2) "override_with_text" — the candidate action is wrong or weak; you write a better Hebrew reply. The handler's stage transition still applies.
3) "escalate_to_eli" — this is a money moment, ambiguous, risky, or off-script. Don't auto-reply. Queue a draft for Eli to approve.
4) "silence" — bot should stay quiet (very rare; e.g. lead just said "תודה" with no question).

ESCALATION TRIGGERS (use "escalate_to_eli"):
- Customer mentions a specific competitor price ("יש לי הצעה ב-1800")
- Customer asks for a discount with a number ("תורידו ל-800")
- Customer is angry / frustrated / threatening to leave
- Custom dimensions / non-standard quantities (sub-tier or odd sizes)
- Customer wants a phone call / meeting
- Customer's intent is unclear after 2+ turns
- Stage is WAITING_FACTORY/WON/DROPPED and message is non-trivial (the candidate says "no_op")

NEVER FABRICATE:
- Specific prices (numbers) unless the candidate explicitly provides them
- Specific delivery dates beyond "אקספרס 25 יום, רגיל 90 יום"
- Promises ("נקדם את ההזמנה", "אזרז")

OUTPUT: JSON only. Schema:
{
  "intent": "<short label, English or Hebrew>",
  "confidence": <0.0..1.0>,
  "recommended_action": "approve_code" | "override_with_text" | "escalate_to_eli" | "silence",
  "override_text": "<Hebrew reply if recommended_action=override_with_text, else null>",
  "reason": "<brief Hebrew explanation, ≤120 chars>",
  "risk_flags": ["<short labels like mentions_competitor_price, asks_for_human, money_moment, etc.>"]
}

Default tilt: when in doubt, escalate_to_eli. Eli would rather see one too many drafts than have the bot say something stupid.`;

function buildUserPrompt(input: SuperviseInput): string {
  const lines: string[] = [];

  lines.push("=== LEAD CONTEXT ===");
  lines.push(`Stage: ${input.stage ?? "(none)"}`);
  if (input.leadName) lines.push(`Name: ${input.leadName}`);
  if (input.phone) lines.push(`Phone: ${input.phone}`);
  if (input.botPaused) lines.push(`bot_paused: true (was manually paused — auto-unpaused on this inbound)`);
  if (input.qState) {
    const q = input.qState;
    const summary: string[] = [];
    if (q.step !== undefined) summary.push(`step=${q.step}`);
    if (q.decisionState) summary.push(`decisionState=${q.decisionState}`);
    if (q.finalState) summary.push(`finalState=${q.finalState}`);
    if (q.doneAt) summary.push("questionnaire_done=true");
    if (summary.length) lines.push(`qState: ${summary.join(", ")}`);
  }

  lines.push("");
  lines.push("=== RECENT THREAD (oldest first) ===");
  const recent = input.recentMessages.slice(-20);
  if (recent.length === 0) {
    lines.push("(no prior messages)");
  } else {
    for (const m of recent) {
      const who = m.direction === "in" ? "Customer" : "Bot/Eli";
      lines.push(`${who}: ${m.text.slice(0, 400)}`);
    }
  }

  lines.push("");
  lines.push("=== CURRENT INBOUND ===");
  lines.push(input.inboundText);

  lines.push("");
  lines.push("=== CANDIDATE ACTION (what the existing handler will do if you approve_code) ===");
  lines.push(`kind: ${input.candidate.kind}`);
  if (input.candidate.intent) {
    lines.push(`predicted_intent: ${input.candidate.intent} (confidence ${input.candidate.intentConfidence ?? "?"})`);
  }
  if (input.candidate.cannedReplyLabel) {
    lines.push(`canned_reply_label: ${input.candidate.cannedReplyLabel}`);
  }
  lines.push(`description: ${input.candidate.description}`);

  lines.push("");
  lines.push("Return JSON only.");

  return lines.join("\n");
}

export async function superviseIncomingMessage(
  input: SuperviseInput
): Promise<SupervisorVerdict> {
  const model = readEnv("SUPERVISOR_MODEL") || "gpt-4o-mini";

  // Allow emergency bypass via env (e.g. supervisor broken in prod).
  if (readEnv("SUPERVISOR_BYPASS") === "1") {
    return {
      recommended: "approve_code",
      intent: input.candidate.intent,
      confidence: input.candidate.intentConfidence,
      reason: "SUPERVISOR_BYPASS=1 — approving candidate without LLM gate",
      overrideText: null,
      riskFlags: ["bypass_enabled"],
      rawJson: null,
      promptVersion: SUPERVISOR_PROMPT_VERSION,
      model: "bypass",
    };
  }

  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    return await onSupervisorFailure(
      input,
      "OPENAI_API_KEY missing — supervisor cannot run",
      model
    );
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const txt = await res.text();
      console.error("[supervisor] non-2xx", res.status, txt.slice(0, 300));
      return await onSupervisorFailure(
        input,
        `OpenAI ${res.status}: ${txt.slice(0, 200)}`,
        model
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? null;
    if (!raw) {
      return await onSupervisorFailure(input, "empty LLM response", model);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[supervisor] non-JSON", raw.slice(0, 200));
      return await onSupervisorFailure(input, "LLM returned non-JSON", model);
    }

    return {
      recommended: normalizeRecommendation(parsed.recommended_action),
      intent: typeof parsed.intent === "string" ? parsed.intent.slice(0, 80) : null,
      confidence: clampConfidence(parsed.confidence),
      reason:
        typeof parsed.reason === "string"
          ? parsed.reason.slice(0, 300)
          : "(no reason given)",
      overrideText:
        typeof parsed.override_text === "string" && parsed.override_text.trim()
          ? parsed.override_text.trim().slice(0, 2000)
          : null,
      riskFlags: Array.isArray(parsed.risk_flags)
        ? parsed.risk_flags
            .filter((x: unknown) => typeof x === "string")
            .map((s: string) => s.slice(0, 60))
        : [],
      rawJson: raw,
      promptVersion: SUPERVISOR_PROMPT_VERSION,
      model,
    };
  } catch (e) {
    return await onSupervisorFailure(
      input,
      `exception: ${e instanceof Error ? e.message : String(e)}`,
      model
    );
  }
}

async function onSupervisorFailure(
  input: SuperviseInput,
  errorDetail: string,
  model: string
): Promise<SupervisorVerdict> {
  // Best-effort Eli DM. Don't let DM failure cascade.
  try {
    const who = input.leadName?.trim() || input.phone || input.sid;
    await sendEliDM(
      `⚠️ Supervisor failed for ${who}\nError: ${errorDetail}\nInbound: "${input.inboundText.slice(0, 200)}"\nBot will NOT respond automatically. Please reply manually from the CRM.`
    );
  } catch (e) {
    console.error("[supervisor] failed to DM Eli on supervisor error", e);
  }
  return {
    recommended: "supervisor_error",
    intent: null,
    confidence: null,
    reason: errorDetail,
    overrideText: null,
    riskFlags: ["supervisor_error"],
    rawJson: null,
    promptVersion: SUPERVISOR_PROMPT_VERSION,
    model,
  };
}

function normalizeRecommendation(raw: unknown): SupervisorRecommendation {
  if (typeof raw !== "string") return "escalate_to_eli";
  const t = raw.toLowerCase().trim();
  if (t === "approve_code") return "approve_code";
  if (t === "override_with_text") return "override_with_text";
  if (t === "escalate_to_eli") return "escalate_to_eli";
  if (t === "silence") return "silence";
  return "escalate_to_eli"; // safe default
}

function clampConfidence(raw: unknown): number | null {
  if (typeof raw !== "number" || !isFinite(raw)) return null;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

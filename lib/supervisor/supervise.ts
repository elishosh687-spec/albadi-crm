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
 *
 * v1.0.0 — initial supervisor (generic guidance only).
 * v1.1.0 — compressed CUSTOMER-FLOW.md policy matrix + BOT-COPY tone rules +
 *          price/date guardrails from scheme.txt.
 */
export const SUPERVISOR_PROMPT_VERSION = "supervisor-v1.1.0";

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

const SYSTEM_PROMPT = `You are the SUPERVISOR layer of a WhatsApp sales bot for an Israeli printed-bag business (Albadi).
Customers write in Hebrew. The bot has deterministic handlers (questionnaire, intent classifier, canned replies) and an Eli-approval draft queue. You gate EVERY inbound message BEFORE any reply leaves.

============================================================
RETURN JSON ONLY. Schema:
{
  "intent": "<short label, English or Hebrew>",
  "confidence": <0.0..1.0>,
  "recommended_action": "approve_code" | "override_with_text" | "escalate_to_eli" | "silence",
  "override_text": "<Hebrew reply if recommended_action=override_with_text, else null>",
  "reason": "<brief Hebrew explanation, ≤120 chars>",
  "risk_flags": ["<short labels: mentions_competitor_price, asks_for_human, money_moment, custom_size, spec_change, urgent, frustrated, ambiguous, etc.>"]
}

============================================================
THE FOUR VERDICTS

1) "approve_code" — candidate action is correct. Handler runs unchanged.
2) "override_with_text" — candidate is wrong or weakly worded. You supply Hebrew reply. Handler's stage transition still applies.
3) "escalate_to_eli" — money moment, ambiguous, risky, off-script. No auto-reply. Draft queued for Eli approval.
4) "silence" — bot stays quiet. RARE. Only for messages like a bare "תודה" / "👍" with no question or progression intent.

============================================================
HARD RULES (NEVER VIOLATE)

- NEVER fabricate prices. No numbers, no ranges, no "from X ILS". The handler / calculator owns prices.
- NEVER promise a specific delivery date. Only allowed phrasing: "אקספרס 25 יום, רגיל 90 יום" (mehavishur — from the order).
- NEVER promise availability or production slots.
- NEVER mark a lead as DROPPED. Only Eli can.
- NEVER override the existing handler when stage transitions matter (accept/logo received). Use approve_code for those.

============================================================
TONE (when you produce override_text)

Voice = first-person singular Eli ("אני"). Plural neutral for the business ("אתם / לכם"). NOT "אתה" (single masculine).
Emoji = 0-1 per message, only when adds. No emoji-spam.
Length = 1-2 sentences max. WhatsApp short messages, not paragraphs.
Style = warm, useful, brief. No salesy fluff, no formal language ("בברכה" forbidden).

============================================================
POLICY MATRIX BY STAGE (from CUSTOMER-FLOW v2)

NEW (questionnaire mid-flight):
  intent       → recommended_action
  accept       → approve_code (questionnaire advances)
  ambiguous answer → approve_code (handler will re-ask, 3-strikes escalates)
  "אחר" / custom → approve_code (handler collects, escalates at end)
  question_meeting / call request → escalate_to_eli + ack "בטח, אתקשר אליכם"
  question_company → override_with_text or approve_code (canned company info)
  total drop-off (silence) → not your call (cron handles cadence)

AWAITING_ESTIMATE (after preliminary quote, decision sub-flow):
  intent              → recommended_action
  accept              → approve_code (handler transitions to AWAITING_LOGO + asks for logo)
  samples_request     → approve_code (handler sends catalog URL)
  negotiating ("יקר") → approve_code (handler asks "יש הצעה מתחרה?")
  reject              → approve_code (handler asks "יש סיבה ספציפית?")
  question_delivery   → approve_code (canned 25/90 days)
  question_inclusive  → approve_code (canned "הכל כלול")
  question_format     → approve_code (canned "כל פורמט בסדר")
  question_payment    → escalate_to_eli (R9 — premature at Stage 2)
  question_meeting    → escalate_to_eli + ack "בטח, אתקשר"
  question_company    → approve_code (canned company card)
  custom_size / spec_change → approve_code (handler asks what to change)
  customer NAMES competitor price ("יש לי ב-1800") → escalate_to_eli (money moment, even if handler would do it)
  customer asks for specific discount amount ("תורידו ל-800") → escalate_to_eli
  frustrated / angry / threatening to leave → escalate_to_eli

AWAITING_LOGO:
  media inbound      → approve_code (handler routes to factory)
  logo share link    → approve_code (handler treats as logo received)
  "אין לי לוגו"      → approve_code (handler escalates with "אתקשר")
  question_format    → approve_code (canned format answer)
  text-only         → approve_code (re-ask up to 3x, then handler escalates)

AWAITING_FINAL (after final price sent):
  accept              → approve_code (WON + Eli DM)
  reject / negotiating → approve_code (handler asks "מה בדיוק?", next turn escalates)
  question_payment    → approve_code (canned 50/50)
  custom_size         → approve_code (handler acks + escalates)
  competitor price mention → escalate_to_eli
  discount with number → escalate_to_eli

WAITING_FACTORY / WON / DROPPED (formerly silent):
  ANY message with substance → escalate_to_eli (handler does nothing — Eli must see)
  bare "תודה" / acknowledgement → silence
  customer asks "מה קורה?" / "איפה זה?" → escalate_to_eli

============================================================
ESCALATION CHECKLIST (when in doubt → escalate)

If ANY of these are true, escalate_to_eli:
- mentions a specific competitor price (number)
- asks for a discount with a number
- asks for a phone call / meeting / human ("question_meeting")
- intent unclear after 2+ turns of clarification
- frustrated / angry / mentions complaint / threatening to leave
- non-standard spec change after Stage 4 (final price)
- stage = WAITING_FACTORY / WON / DROPPED and message has substance

Default tilt: when in doubt, escalate_to_eli. Eli would rather see one too many drafts than have the bot say something stupid.

============================================================
OVERRIDE_WITH_TEXT — when to actually use it

Reserve for cases where:
- The candidate action exists but its canned text is wrong for this specific phrasing
- The customer needs a personalized touch ("פנייה אישית" — e.g. mentioned a personal detail, asked something tangential)
- You can give a clearly better reply that stays within hard rules above

When NOT to override:
- If candidate is approve_code with a known canned reply (delivery / payment / inclusive / format / samples / company) — let it run. Don't paraphrase canned answers.
- If you'd be tempted to fabricate a price or date — don't override. Escalate.

============================================================
EXAMPLES OF GOOD VERDICTS

Customer (AWAITING_ESTIMATE): "יקר לי, מצאתי ב-1500"
→ recommended_action: escalate_to_eli
  intent: negotiating_with_competitor_price
  reason: לקוח נתן מחיר מתחרה — שיקול מסחרי
  risk_flags: ["mentions_competitor_price", "money_moment"]

Customer (AWAITING_ESTIMATE): "מה זמן האספקה?"
→ recommended_action: approve_code
  intent: question_delivery
  reason: שאלת אספקה — קיים canned (25/90)

Customer (WAITING_FACTORY): "מה קורה עם ההצעה?"
→ recommended_action: escalate_to_eli
  intent: status_check
  reason: לקוח ב-WAITING_FACTORY שואל סטטוס — הקוד שותק

Customer (AWAITING_ESTIMATE): "תתקשר אליי"
→ recommended_action: escalate_to_eli (or approve_code if candidate handles it)
  intent: question_meeting
  reason: בקשת שיחה — חוזר ל-Eli
  risk_flags: ["asks_for_human"]

Customer (NEW, mid-questionnaire): "5000 יחידות"
→ recommended_action: approve_code
  intent: questionnaire_answer
  reason: תשובה תקנית לשאלת כמות

Customer (AWAITING_LOGO): (media inbound, no text)
→ recommended_action: approve_code
  intent: logo_received
  reason: handler מטפל ב-factory routing

Customer (after WON): "תודה!"
→ recommended_action: silence
  intent: closure
  reason: סגירה, אין צורך לענות שוב`;

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

/**
 * Follow-up supervisor — LLM gate for cron-triggered follow-up messages.
 *
 * Mirrors the inbound supervisor pattern but for OUTBOUND-initiated turns
 * (no customer message to react to). The cron picks a lead whose cadence
 * has elapsed, the supervisor looks at the lead's full context, and decides:
 *
 *   approve_template    — send the legacy canned template verbatim
 *   override_with_text  — send a personalized Hebrew message (NOT a price quote)
 *   escalate_to_eli     — don't send anything; queue a draft + DM Eli
 *   silence             — skip this cycle, don't consume an attempt
 *   supervisor_error    — LLM failed; DM Eli, no send
 *
 * SAFETY: the cron still enforces the hard 3-attempt limit upstream of this
 * call. The LLM cannot bypass it.
 */
import { sendEliDM } from "../notify/eli";

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 12_000;

export const FOLLOWUP_SUPERVISOR_PROMPT_VERSION = "followup-v1.0.0";

export type FollowupRecommendation =
  | "approve_template"
  | "override_with_text"
  | "escalate_to_eli"
  | "silence"
  | "supervisor_error";

export interface FollowupVerdict {
  recommended: FollowupRecommendation;
  confidence: number | null;
  reason: string;
  overrideText: string | null;
  riskFlags: string[];
  rawJson: string | null;
  promptVersion: string;
  model: string;
}

export interface FollowupSuperviseInput {
  sid: string;
  jid: string;
  leadName: string | null;
  phone: string | null;
  stage: string | null;
  qState: any;
  recentMessages: { direction: "in" | "out"; text: string; sender: string | null }[];
  /** Stage-keyed template label (MID_QUESTIONNAIRE / INITIAL_QUOTE_SENT / etc). */
  templateLabel: string;
  /** 1-based — which follow-up attempt is this. */
  attempt: number;
  /** Wait-ms the cadence rule used to decide it's time. */
  cadenceMs: number;
  /** Hours since last bot/eli outbound. */
  gapHours: number | null;
  /** The deterministic template string the cron would send if you approve. */
  candidateTemplate: string;
  /** Lead notes (free-text from Eli). */
  notes: string | null;
  /** Bot summary stored on the lead. */
  botSummary: string | null;
}

const SYSTEM_PROMPT = `You are the FOLLOWUP SUPERVISOR for a WhatsApp sales bot at an Israeli printed-bag business (Albadi). Customers are Hebrew speakers.

UNLIKE the inbound supervisor, you are NOT reacting to a customer message. The cron has decided a lead has been silent long enough to nudge. Your job: look at the lead's full state and decide whether nudging makes sense, and if so, with what message.

============================================================
RETURN JSON ONLY. Schema:
{
  "confidence": <0.0..1.0>,
  "recommended_action": "approve_template" | "override_with_text" | "escalate_to_eli" | "silence",
  "override_text": "<Hebrew reply if recommended_action=override_with_text, else null>",
  "reason": "<brief Hebrew explanation, ≤120 chars>",
  "risk_flags": ["<short labels: stale_thread, customer_silent_too_long, recent_human_touch, sensitive_lead, etc.>"]
}

============================================================
THE FOUR VERDICTS

1) "approve_template" — the candidate template is appropriate. Send it verbatim. Use for happy-path leads (no special context, customer just hasn't replied).
2) "override_with_text" — the lead has CONTEXT that makes a personalized nudge much better. You write a 1-2 sentence Hebrew message referencing the lead's actual situation (their last reply, what they said, the date they asked for, etc).
3) "escalate_to_eli" — DON'T send. The lead needs a human touch (sensitive, money moment in air, customer last expressed frustration, this looks like a lead that's worth a call not a text). Queue draft for Eli.
4) "silence" — skip this cycle. The lead's last action signals they don't want a nudge right now (e.g. they said "אבדוק ואחזור אליך" recently, or sent something that requires Eli's manual action and is awaiting it). Don't consume an attempt.

============================================================
HARD RULES (NEVER VIOLATE)

- NEVER fabricate prices. No numbers, no ranges. Templates and Eli own prices.
- NEVER promise a specific delivery date. Only "אקספרס 25 / רגיל 90" allowed.
- NEVER apologize for "being a bot" or expose mechanics. You ARE Eli.
- NEVER reference internal stages/labels. Talk to the customer like a human.
- override_with_text must be ≤ 2 sentences, warm, brief, useful.

============================================================
TONE (when you write override_text)

Voice = first-person singular Eli ("אני"). Plural neutral for business ("אתם/לכם"). NOT "אתה".
Emoji = 0-1 per message, only when adds.
Length = 1-2 sentences. WhatsApp short.
Style = warm, useful, brief. No salesy fluff.

============================================================
WHEN TO OVERRIDE (vs approve template)

Override when ANY of these are true:
- Lead's last inbound mentioned a specific date or commitment ("תתקשר אליי ב-18.5") — your override should reference it
- Lead's last inbound asked something specific the bot didn't fully answer
- Notes contain a specific instruction ("לחזור אליו אחרי החג")
- There's a clear personal detail the template ignores (name in last message, etc)

Don't override when:
- Lead is generic — no special context — let the template do its job

============================================================
WHEN TO ESCALATE (vs send anything)

Escalate when ANY of these are true:
- attempt = 3 (last shot — Eli should handle personally)
- Lead notes flag NEEDS_ELI or anything sensitive
- Last bot message was already escalation-like
- Lead expressed frustration in recent history
- Stage is FACTORY_CHECK with subFlow=awaiting_factory_estimate — text follow-up rarely right; Eli should call

============================================================
WHEN TO SILENCE (rare — skip this cycle)

Silence when:
- Customer's last inbound explicitly said "אחזור אליך / אבדוק ואענה / תן לי יומיים" and that grace period hasn't passed
- Customer just got a reply that asked them a specific question and they haven't had reasonable time to answer

============================================================
EXAMPLES

Context: Eli notes = "אמר ליצור איתו קשר ב-18.5.26". Today is 2026-05-18. Stage = INITIAL_QUOTE_SENT. attempt = 1.
→ override_with_text:
  reason: "אסף ביקש קשר היום ב-18.5 — מזכיר ספציפית"
  override_text: "אסף, היום ה-18.5 כמו שביקשת. אפשר להתקשר עכשיו?"

Context: Generic lead, no last inbound, sat 24h after quote. Stage = INITIAL_QUOTE_SENT. attempt = 1.
→ approve_template:
  reason: "אין קונטקסט מיוחד — טמפלייט תקין"

Context: Lead stage = FACTORY_CHECK (subFlow=awaiting_factory_estimate). Eli notes empty. attempt = 1.
→ escalate_to_eli:
  reason: "FACTORY_CHECK — אלי צריך להתקשר, לא טקסט"

Context: Lead said "תן לי יומיים" 18h ago. attempt = 1.
→ silence:
  reason: "ביקש יומיים, רק 18 שעות עברו"

Context: attempt = 3 on any lead.
→ escalate_to_eli:
  reason: "ניסיון שלישי — Eli מטפל ידנית"`;

function buildUserPrompt(input: FollowupSuperviseInput): string {
  const lines: string[] = [];

  lines.push("=== LEAD CONTEXT ===");
  if (input.leadName) lines.push(`Name: ${input.leadName}`);
  if (input.phone) lines.push(`Phone: ${input.phone}`);
  lines.push(`Stage: ${input.stage ?? "(none)"}`);
  if (input.notes) lines.push(`Notes (Eli's): ${input.notes.slice(0, 500)}`);
  if (input.botSummary) lines.push(`Bot summary: ${input.botSummary.slice(0, 300)}`);

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
  lines.push("=== CADENCE INFO ===");
  lines.push(`Follow-up attempt #${input.attempt} (1-based)`);
  lines.push(`Template label: ${input.templateLabel}`);
  lines.push(`Cadence triggered at: ${Math.round(input.cadenceMs / 1000 / 60)} minutes since last outbound`);
  if (input.gapHours !== null) {
    lines.push(`Hours since last bot/eli outbound: ${input.gapHours.toFixed(1)}`);
  }

  lines.push("");
  lines.push("=== RECENT THREAD (oldest first) ===");
  const recent = input.recentMessages.slice(-15);
  if (recent.length === 0) {
    lines.push("(no prior messages)");
  } else {
    for (const m of recent) {
      const who = m.direction === "in"
        ? "Customer"
        : m.sender === "eli"
          ? "Eli (manual)"
          : "Bot";
      lines.push(`${who}: ${m.text.slice(0, 300)}`);
    }
  }

  lines.push("");
  lines.push("=== CANDIDATE TEMPLATE (what the cron would send if you approve) ===");
  lines.push(input.candidateTemplate);

  lines.push("");
  lines.push("Return JSON only.");

  return lines.join("\n");
}

export async function superviseFollowup(
  input: FollowupSuperviseInput
): Promise<FollowupVerdict> {
  const model = readEnv("SUPERVISOR_MODEL") || "gpt-4o-mini";

  if (readEnv("SUPERVISOR_BYPASS") === "1") {
    return {
      recommended: "approve_template",
      confidence: 0.5,
      reason: "SUPERVISOR_BYPASS=1 — sending template without LLM gate",
      overrideText: null,
      riskFlags: ["bypass_enabled"],
      rawJson: null,
      promptVersion: FOLLOWUP_SUPERVISOR_PROMPT_VERSION,
      model: "bypass",
    };
  }

  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    return onFailure(input, "OPENAI_API_KEY missing", model);
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
        temperature: 0.3,
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
      console.error("[followup-supervisor] non-2xx", res.status, txt.slice(0, 200));
      return onFailure(input, `OpenAI ${res.status}`, model);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? null;
    if (!raw) return onFailure(input, "empty LLM response", model);

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return onFailure(input, "non-JSON response", model);
    }

    return {
      recommended: normalize(parsed.recommended_action),
      confidence: clamp(parsed.confidence),
      reason:
        typeof parsed.reason === "string"
          ? parsed.reason.slice(0, 300)
          : "(no reason)",
      overrideText:
        typeof parsed.override_text === "string" && parsed.override_text.trim()
          ? parsed.override_text.trim().slice(0, 800)
          : null,
      riskFlags: Array.isArray(parsed.risk_flags)
        ? parsed.risk_flags
            .filter((x: unknown) => typeof x === "string")
            .map((s: string) => s.slice(0, 60))
        : [],
      rawJson: raw,
      promptVersion: FOLLOWUP_SUPERVISOR_PROMPT_VERSION,
      model,
    };
  } catch (e) {
    return onFailure(
      input,
      `exception: ${e instanceof Error ? e.message : String(e)}`,
      model
    );
  }
}

async function onFailure(
  input: FollowupSuperviseInput,
  detail: string,
  model: string
): Promise<FollowupVerdict> {
  try {
    const who = input.leadName?.trim() || input.phone || input.sid;
    await sendEliDM(
      `⚠️ Followup supervisor failed for ${who} (stage=${input.stage ?? "?"}, attempt=${input.attempt})\nError: ${detail}\nNo follow-up sent.`
    );
  } catch (e) {
    console.error("[followup-supervisor] failed to DM Eli on supervisor error", e);
  }
  return {
    recommended: "supervisor_error",
    confidence: null,
    reason: detail,
    overrideText: null,
    riskFlags: ["supervisor_error"],
    rawJson: null,
    promptVersion: FOLLOWUP_SUPERVISOR_PROMPT_VERSION,
    model,
  };
}

function normalize(raw: unknown): FollowupRecommendation {
  if (typeof raw !== "string") return "escalate_to_eli";
  const t = raw.toLowerCase().trim();
  if (t === "approve_template") return "approve_template";
  if (t === "override_with_text") return "override_with_text";
  if (t === "escalate_to_eli") return "escalate_to_eli";
  if (t === "silence") return "silence";
  return "escalate_to_eli";
}

function clamp(raw: unknown): number | null {
  if (typeof raw !== "number" || !isFinite(raw)) return null;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

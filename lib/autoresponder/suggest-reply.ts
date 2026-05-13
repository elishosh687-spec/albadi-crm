/**
 * LLM-drafted reply suggestions for Eli on escalated leads.
 *
 * Given the last N messages with a lead + the lead's current pipeline_stage
 * and bot_summary, ask the LLM to produce 2-3 short Hebrew reply variants
 * Eli can pick, edit, and send.
 *
 * Voice constraints match docs/BOT-COPY.md:
 *   - First person singular ("אני", "אחזור אליכם")
 *   - Plural-neutral address ("אתם / לכם")
 *   - 0-1 emoji per message
 *   - Short — 1-2 sentences max
 *
 * Soft-fails to an empty array on any error.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 12000;

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export interface ConversationMessage {
  direction: "in" | "out";
  text: string;
  at?: string;
}

export interface SuggestRepliesInput {
  recentMessages: ConversationMessage[];
  leadName?: string | null;
  pipelineStage?: string | null;
  botSummary?: string | null;
  /** Free-text hint Eli can pass: "ask about logo", "offer 10% discount", etc. */
  hint?: string | null;
}

const SYSTEM_PROMPT = `אתה כותב הצעות תגובה בעברית עבור אלי (בעל עסק לשקיות ממותגות, "אלבד") שמשוחח עם לקוחות ב-WhatsApp.

כללי קול קריטיים:
- גוף ראשון יחיד ("אני", "אחזור אליכם", "אתקשר") — לא "אנחנו", לא "הצוות".
- פנייה ניטרלית רבים ("אתם / לכם") — לא "אתה" בזכר.
- אימוג'ים מינימליים: 0 או 1 בכל הודעה, רק אם מוסיף.
- קצר: משפט אחד או שניים, לא פסקה.
- שיחתי, לא תאגידי. בלי "מערכת", "פנייה התקבלה", "אנא".

החזר 3 וריאציות תגובה שונות באוריינטציה (לא נוסחים שונים של אותו דבר). כל תגובה צריכה:
- להציע פעולה ברורה אחת
- להתאים לטון של הלקוח בשיחה
- לקדם את העסקה (לא סתם להחזיר את הכדור)

החזר רק JSON: { "replies": ["...", "...", "..."] }. שום טקסט נוסף.`;

export async function suggestReplies(
  input: SuggestRepliesInput
): Promise<string[]> {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    console.warn("[suggest-reply] OPENAI_API_KEY missing");
    return [];
  }
  const model = readEnv("OPENAI_MODEL") || "gpt-4o-mini";

  const ctxLines: string[] = [];
  if (input.leadName) ctxLines.push(`שם הלקוח: ${input.leadName}`);
  if (input.pipelineStage)
    ctxLines.push(`שלב נוכחי: ${input.pipelineStage}`);
  if (input.botSummary)
    ctxLines.push(`סיכום מצב (מהבוט): ${input.botSummary}`);
  if (input.recentMessages.length > 0) {
    const lines = input.recentMessages.slice(-12).map((m) => {
      const who = m.direction === "in" ? "לקוח" : "אני";
      return `${who}: ${m.text}`;
    });
    ctxLines.push("שיחה אחרונה:\n" + lines.join("\n"));
  }
  if (input.hint?.trim()) {
    ctxLines.push(`הכוונה שלי לתגובה: ${input.hint.trim()}`);
  }
  const userPrompt = [
    ctxLines.join("\n\n"),
    "כתוב 3 הצעות תגובה. החזר JSON בלבד.",
  ]
    .filter(Boolean)
    .join("\n\n");

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
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const txt = await res.text();
      console.error("[suggest-reply] openai non-2xx", res.status, txt.slice(0, 200));
      return [];
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      console.error("[suggest-reply] openai empty response");
      return [];
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[suggest-reply] non-JSON response", raw.slice(0, 200));
      return [];
    }
    const arr = Array.isArray(parsed?.replies) ? parsed.replies : [];
    return arr
      .filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s: string) => s.trim())
      .slice(0, 3);
  } catch (e) {
    console.error("[suggest-reply] error", e);
    return [];
  }
}

/**
 * Dedicated single-draft generator for money-moment escalations. Tuned to
 * (a) NOT commit to discounts, final prices, or timelines on Eli's behalf,
 * (b) acknowledge + defer politely so the customer is not ignored while
 * Eli decides, (c) match the Eli voice constraints (1st person singular,
 * plural-neutral "you", 0-1 emoji, short).
 *
 * Soft-fails to null on any error — the caller treats null as "no draft
 * available, queue stays empty for this escalation" which is fine; the
 * existing Eli DM still went out.
 */
const MONEY_DRAFT_SYSTEM_PROMPT = `אתה כותב טיוטת תגובה אחת בעברית עבור אלי (בעל עסק לשקיות ממותגות, "אלבד") עבור שיחה שבה נקודה כספית עלתה — הצעת מחיר, בקשת הנחה, משא ומתן, או שינוי מפרט שמשפיע על מחיר.

כללי קול קריטיים:
- גוף ראשון יחיד ("אני", "אחזור אליכם", "אתקשר").
- פנייה ניטרלית רבים ("אתם / לכם") — לא "אתה".
- 0 או 1 אימוג'ים. קצר — משפט אחד או שניים.
- שיחתי, לא תאגידי.

כללים על תוכן (קריטיים — אסור לחרוג):
- אסור להבטיח הנחה ספציפית באחוזים או בסכום.
- אסור לתת מחיר סופי או מספר חדש.
- אסור להתחייב על לוח זמנים מדויק שלא הוסכם.
- מותר להכיר בבקשה ולומר שאלי בודק / חוזר.
- מותר להציע פעולה (שיחה, בדיקה) אם זה מקדם את העסקה.

החזר JSON בלבד: { "reply": "..." }. שום טקסט נוסף.`;

export interface DraftMoneyReplyInput {
  recentMessages: ConversationMessage[];
  leadName?: string | null;
  pipelineStage?: string | null;
  botSummary?: string | null;
  moneyReason?: string | null;
}

export async function draftMoneyReply(
  input: DraftMoneyReplyInput
): Promise<string | null> {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    console.warn("[draft-money-reply] OPENAI_API_KEY missing");
    return null;
  }
  const model = readEnv("OPENAI_MODEL") || "gpt-4o-mini";

  const ctxLines: string[] = [];
  if (input.leadName) ctxLines.push(`שם הלקוח: ${input.leadName}`);
  if (input.pipelineStage) ctxLines.push(`שלב נוכחי: ${input.pipelineStage}`);
  if (input.botSummary) ctxLines.push(`מה הבוט הבין: ${input.botSummary}`);
  if (input.moneyReason)
    ctxLines.push(`סוג נקודת הכסף: ${input.moneyReason}`);
  if (input.recentMessages.length > 0) {
    const lines = input.recentMessages.slice(-12).map((m) => {
      const who = m.direction === "in" ? "לקוח" : "אני";
      return `${who}: ${m.text}`;
    });
    ctxLines.push("שיחה אחרונה:\n" + lines.join("\n"));
  }
  const userPrompt = [
    ctxLines.join("\n\n"),
    "כתוב טיוטת תגובה אחת. החזר JSON בלבד.",
  ]
    .filter(Boolean)
    .join("\n\n");

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
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: MONEY_DRAFT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(
        "[draft-money-reply] openai non-2xx",
        res.status,
        (await res.text()).slice(0, 200)
      );
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const reply = typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
    return reply || null;
  } catch (e) {
    console.error("[draft-money-reply] error", e);
    return null;
  }
}

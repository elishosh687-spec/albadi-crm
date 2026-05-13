/**
 * LLM intent classifier for mid-pipeline inbound messages (everything past
 * the questionnaire). Direct fetch to OpenAI Chat Completions — keeps the
 * dependency surface small and the call easy to replace with another model.
 *
 * The classifier produces a single intent tag the webhook can route on:
 *   - accept           → customer is OK with the quote → AWAITING_LOGO
 *   - reject           → customer says no / not interested → NEEDS_ELI
 *   - negotiating      → customer wants a different price / haggle → NEEDS_ELI
 *   - samples_request  → "have a catalog?" / "send samples" → bot sends link
 *   - custom_size      → customer mentions a non-standard spec → NEEDS_ELI
 *   - question         → factual question we cannot answer deterministically
 *                        ("how long?", "any colors available?") → NEEDS_ELI
 *   - other            → ambiguous / chit-chat → fall back to follow-up loop
 *
 * Soft-fails to "other" on any error so a flaky API never blocks the webhook.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 8000;

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export type Intent =
  | "accept"
  | "reject"
  | "negotiating"
  | "samples_request"
  | "custom_size"
  | "question"
  | "other";

export interface IntentResult {
  intent: Intent;
  confidence: number; // 0..1
  summary?: string;   // short Hebrew note for Eli when intent is NEEDS_ELI-bound
}

const SYSTEM_PROMPT = `אתה מסווג כוונות של לקוחות בעברית לעסק לייצור שקיות ממותגות (Albadi).
הלקוח כבר קיבל הצעת מחיר ושלח הודעה תגובתית.
המשימה: לסווג את ההודעה לאחת מהקטגוריות:

- "accept" — הלקוח מאשר את ההצעה / מסכים / רוצה להמשיך. דוגמאות: "מתאים", "אישור", "סבבה", "אוקיי", "מקובל", "כן", "ok".
- "reject" — הלקוח מסרב / לא מעוניין / סוגר. דוגמאות: "לא תודה", "לא מעוניין", "תפסיק", "stop".
- "negotiating" — הלקוח רוצה הנחה / מתמקח על מחיר. דוגמאות: "המחיר יקר", "תורידו ל-800", "תוכלו להוריד?", "זה הרבה".
- "samples_request" — הלקוח מבקש דוגמאות / קטלוג. דוגמאות: "יש דוגמאות?", "קטלוג?", "אפשר לראות תמונות?".
- "custom_size" — הלקוח מבקש מידה או כמות לא סטנדרטית שלא הופיעה בשאלון. דוגמאות: "אני צריך 25x10x35", "אפשר 7500 יחידות?", "יש בגודל אחר?", מספרים עם × או x.
- "question" — שאלה תוכנית שלא נכנסת לאף קטגוריה: זמן אספקה, תשלום, תמונות מוצר אחרות, חומרים, פגישה. דוגמאות: "כמה זמן ייקח?", "איך משלמים?", "אפשר להיפגש?".
- "other" — צ'אט סתמי / לא ברור / לא קשור. דוגמאות: "תודה", "אוקיי אחזור אליך", "בוקר טוב".

החזר רק JSON במבנה: { "intent": "...", "confidence": 0.0-1.0, "summary": "תיאור קצר באנגלית או עברית (≤80 תווים)" }.
summary רלוונטי בעיקר כש-intent הוא reject, negotiating, custom_size, או question — תקציר שיעזור לאדם בצוות להבין מה הלקוח רצה.`;

interface RecentMessage {
  direction: "in" | "out";
  text: string;
}

export interface ClassifyInput {
  inboundText: string;
  recentMessages?: RecentMessage[]; // newest last
  leadName?: string | null;
  pipelineStage?: string | null;
}

export async function classifyIntent(input: ClassifyInput): Promise<IntentResult> {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    console.warn("[intent] OPENAI_API_KEY missing — defaulting to 'other'");
    return { intent: "other", confidence: 0 };
  }
  const model = readEnv("OPENAI_MODEL") || "gpt-4o-mini";

  const context: string[] = [];
  if (input.leadName) context.push(`שם הלקוח: ${input.leadName}`);
  if (input.pipelineStage) context.push(`שלב נוכחי בפייפליין: ${input.pipelineStage}`);
  if (input.recentMessages && input.recentMessages.length > 0) {
    const recent = input.recentMessages.slice(-6).map((m) => {
      const who = m.direction === "in" ? "לקוח" : "אנחנו";
      return `${who}: ${m.text}`;
    });
    context.push("שיחה אחרונה:\n" + recent.join("\n"));
  }
  const userPrompt = [
    context.join("\n\n"),
    `הודעה חדשה מהלקוח: ${JSON.stringify(input.inboundText)}`,
    "סווג ל-JSON בלבד.",
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
        temperature: 0,
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
      console.error("[intent] openai non-2xx", res.status, txt.slice(0, 200));
      return { intent: "other", confidence: 0 };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      console.error("[intent] openai empty response", data);
      return { intent: "other", confidence: 0 };
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[intent] non-JSON response", raw.slice(0, 200));
      return { intent: "other", confidence: 0 };
    }
    const intent = normalizeIntent(parsed.intent);
    const confidence =
      typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : 0.5;
    const summary =
      typeof parsed.summary === "string" && parsed.summary.length > 0
        ? parsed.summary.slice(0, 200)
        : undefined;
    return { intent, confidence, summary };
  } catch (e) {
    console.error("[intent] classify error", e);
    return { intent: "other", confidence: 0 };
  }
}

function normalizeIntent(raw: unknown): Intent {
  if (typeof raw !== "string") return "other";
  const t = raw.toLowerCase().trim();
  const map: Record<string, Intent> = {
    accept: "accept",
    reject: "reject",
    negotiating: "negotiating",
    negotiate: "negotiating",
    samples_request: "samples_request",
    samples: "samples_request",
    custom_size: "custom_size",
    custom: "custom_size",
    question: "question",
    other: "other",
  };
  return map[t] ?? "other";
}

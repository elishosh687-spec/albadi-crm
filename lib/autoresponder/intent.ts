/**
 * LLM intent classifier for mid-pipeline inbound messages (everything past
 * the questionnaire). Direct fetch to OpenAI Chat Completions — keeps the
 * dependency surface small and the call easy to replace with another model.
 *
 * Intent categories align with docs/CUSTOMER-FLOW.md v2 sub-flows:
 *   - accept              → customer ok with quote → next stage
 *   - reject              → customer says no → ask "יש סיבה?"
 *   - negotiating         → customer says "יקר" / wants discount → "הצעה מתחרה?"
 *   - samples_request     → catalog link
 *   - custom_size         → non-standard spec → escalate (Stage 2) / loopback (Stage 4)
 *   - question_delivery   → "כמה זמן ייקח?" → canned reply 25/90
 *   - question_inclusive  → "כולל הכל?" / "כולל משלוח?" → canned "כן הכל כלול"
 *   - question_payment    → "איך משלמים?" → canned 50/50
 *   - question_format     → "איזה פורמט לוגו?" → canned "כל פורמט בסדר"
 *   - question_meeting    → "אפשר בן-אדם?" / "אפשר לדבר?" → escalate
 *   - question_other      → other factual question we can't answer → escalate
 *   - other               → chit-chat / ambiguous → cadence keeps nudging
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
  | "question_delivery"
  | "question_inclusive"
  | "question_payment"
  | "question_format"
  | "question_meeting"
  | "question_company"
  | "question_other"
  | "other";

export interface IntentResult {
  intent: Intent;
  confidence: number; // 0..1
  summary?: string;   // short Hebrew note for Eli when intent is NEEDS_ELI-bound
}

const SYSTEM_PROMPT = `אתה מסווג כוונות של לקוחות בעברית לעסק לייצור שקיות ממותגות (Albadi).
הלקוח כבר קיבל הצעת מחיר (משוערת או סופית) ושלח הודעה תגובתית.
המשימה: לסווג את ההודעה לאחת מהקטגוריות הבאות בדיוק:

- "accept" — הלקוח מאשר את ההצעה / מסכים / רוצה להמשיך. דוגמאות: "מתאים", "אישור", "סבבה", "אוקיי", "מקובל", "כן", "ok", "בא נסגור", "איך מזמינים?".
- "reject" — הלקוח דוחה / לא מעוניין / סוגר את השיחה ללא רמז למחיר. דוגמאות: "לא תודה", "לא בשבילי", "לא מעוניין", "אני אחפש במקום אחר".
- "negotiating" — הלקוח רוצה הנחה / אומר שיקר / מציע מחיר נמוך יותר / מציין מתחרה זול יותר. דוגמאות: "יקר", "יקר מדי", "אפשר הנחה?", "אצל המתחרה X זה זול יותר", "תורידו ל-800", "זה הרבה".
- "samples_request" — הלקוח מבקש לראות דוגמאות / קטלוג / תמונות מוצר. דוגמאות: "יש דוגמאות?", "קטלוג?", "אפשר לראות תמונות?".
- "custom_size" — הלקוח מבקש מידה או כמות לא סטנדרטית שלא הופיעה בשאלון, או רוצה לשנות את המפרט. דוגמאות: "רוצה 7500 יחידות", "בגודל 25x10x35", "אפשר 2 צבעים במקום 3?", "פחות ידיות". מספרים עם × או x הם רמז חזק.
- "question_delivery" — שאלה על זמן אספקה / משלוח / מתי מקבלים. דוגמאות: "כמה זמן ייקח?", "מתי תגיע הסחורה?", "כמה זמן אקספרס?", "מתי?".
- "question_inclusive" — שאלה אם המחיר כולל הכל / משלוח / מע"מ / ידיות / צבעים. דוגמאות: "כולל הכל?", "כולל משלוח?", "המחיר סופי?", "יש מע""מ נוסף?".
- "question_payment" — שאלה על תנאי תשלום / איך משלמים / מקדמה. דוגמאות: "איך משלמים?", "תנאי תשלום?", "צריך מקדמה?", "כמה אחוז להזמנה?".
- "question_format" — שאלה על פורמט הלוגו / איך לשלוח לוגו / איזה קובץ צריך. דוגמאות: "איזה פורמט?", "PDF או JPG?", "באיזה גודל לשלוח לוגו?", "וקטור או רגיל?".
- "question_meeting" — בקשה לדבר עם בן-אדם / פגישה / שיחת טלפון. דוגמאות: "אפשר בן-אדם?", "אפשר לדבר עם מישהו?", "אפשר להיפגש?", "תתקשרו אליי".
- "question_company" — שאלה על מי אנחנו / החברה / המפעל / הוותק / מה אנחנו עושים. דוגמאות: "מי אתם?", "ספרו על החברה", "מה אתם עושים?", "כמה שנים אתם בשוק?", "אתם המפעל?", "יש לכם אתר?".
- "question_other" — שאלה תוכנית אחרת שלא נכנסת לקטגוריות לעיל (חומר, בדיקות איכות, אחריות, וכו'). דוגמאות: "מה החומר?", "יש אחריות?", "איך הולכת ההדפסה?".
- "other" — צ'אט סתמי / לא ברור / לא קשור / "אחזור אליך". דוגמאות: "תודה", "אוקיי אחזור אליך", "בוקר טוב", "🙏".

החזר רק JSON במבנה: { "intent": "...", "confidence": 0.0-1.0, "summary": "תיאור קצר באנגלית או עברית (≤80 תווים)" }.
summary רלוונטי בעיקר כש-intent הוא reject / negotiating / custom_size / question_meeting / question_other — תקציר שיעזור לאדם בצוות להבין מה הלקוח רצה.`;

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
    question_delivery: "question_delivery",
    delivery: "question_delivery",
    question_inclusive: "question_inclusive",
    inclusive: "question_inclusive",
    question_payment: "question_payment",
    payment: "question_payment",
    question_format: "question_format",
    format: "question_format",
    question_meeting: "question_meeting",
    meeting: "question_meeting",
    question_company: "question_company",
    company: "question_company",
    question_other: "question_other",
    question: "question_other",
    other: "other",
  };
  return map[t] ?? "other";
}

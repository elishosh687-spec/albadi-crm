/**
 * Unmatch agent — last resort before Eli.
 *
 * Called from decision.ts in 3 spots where the deterministic switch couldn't
 * resolve the customer's reply:
 *   1. intent="other" (Stage 2/4) — previously a no_op while cron nudged.
 *   2. intent="question_other" — previously an instant escalate.
 *   3. awaiting_competitor_offer with no digits + no clear reject — previously
 *      an ambiguous escalate.
 *
 * The agent gets the full lead context (history, qState, FAQ, business rules)
 * and decides one of:
 *   - reply:    send `replyText` to the customer, no escalation.
 *   - escalate: hand off to Eli with `llmAnalysis` + `recommendation`.
 *   - noop:     do nothing (cron / cadence keeps the flow alive).
 *
 * Hard rules baked into the system prompt:
 *   - NEVER quote a price.
 *   - NEVER promise a delivery date.
 *   - If the customer asks for a human, escalate.
 *   - When uncertain, escalate (with rich context) — never guess.
 *
 * Soft-fails to `{ action: "noop" }` on any LLM error so the existing fallback
 * (no_op / escalate) runs unchanged.
 */
import { callLLM } from "./openai-client";
import { buildLLMContext, renderContextForPrompt } from "./llm-context";

const BOM = "﻿";
function envFlag(key: string): boolean {
  const raw = (process.env[key] ?? "").trim();
  const v = raw.startsWith(BOM) ? raw.slice(1) : raw;
  return v === "1" || v.toLowerCase() === "true";
}

export type UnmatchAction = "reply" | "escalate" | "noop";

export type EscalationKind =
  | "reject"
  | "negotiating"
  | "spec_change"
  | "question"
  | "generic";

export interface UnmatchResult {
  action: UnmatchAction;
  /** When action="reply": the Hebrew reply to send the customer. */
  replyText?: string;
  /** When action="escalate": what the customer wants (Hebrew, for Eli's DM). */
  llmAnalysis?: string;
  /** When action="escalate": what Eli should do next (Hebrew). */
  recommendation?: string;
  /** When action="escalate": classification hint for the DM template. */
  kind?: EscalationKind;
  /** 0..1 — agent's self-reported confidence. */
  confidence: number;
}

const SYSTEM_PROMPT = `אתה בוט מכירות של Albadi (ייצור שקיות ממותגות). קיבלת הודעה שהבוט הרגיל לא הצליח לסווג. תפקידך: לפתור אם אפשר, ולסמן לאלי (הבעלים) רק כשבאמת צריך.

כללים שאסור לעבור (HARD):
- אסור לציין מחיר. בכלל. גם לא טווח, "בערך X", "מסביב ל-Y". המחירים באים מהמחשבון או מאלי.
- אסור להבטיח תאריך משלוח ספציפי. רק "אקספרס" / "רגיל" כקטגוריה.
- אם לקוח מבקש אדם / טלפון / פגישה — escalate מיד.
- בכל ספק — escalate. אל תנחש.

מה אתה יכול לעשות:
- לענות שאלות מידע על המוצר (חומר, הדפסה, אחריות, מינימום, אספקה) — מתוך ה-FAQ.
- להבהיר מה הלקוח רוצה כשהוא כתב משהו עמום.
- לתת ack חברי לחפיפות צד (תודה, ברכות, סיפור צד).
- אם הלקוח מציע כמות גדולה יותר ושואל על הנחה — תאמר שהנציג ישקול ויחזור (אל תצטט שום מחיר!).

איך לבחור action:
- "reply" — יש לך מה לענות, וזה לא דורש אלי. שגרתי: שאלת מידע, ack, "הנציג ישקול".
- "escalate" — דרוש אלי. שגרתי: מיקוח עם מספרים, בקשת אדם, שינוי מפרט מורכב, תלונה, אי-ודאות.
- "noop" — ההודעה לא דורשת תגובה (אימוג'י סתמי, תודה ברורה). יקרה לעיתים נדירות.

החזר JSON בלבד:
{
  "action": "reply" | "escalate" | "noop",
  "replyText": "<טקסט בעברית קצרה לשליחה ללקוח, אם action=reply, אחרת null>",
  "llmAnalysis": "<משפט עברית: מה הלקוח רוצה / שואל. רלוונטי אם action=escalate>",
  "recommendation": "<משפט עברית: מה אלי צריך לעשות. רלוונטי אם action=escalate>",
  "kind": "reject" | "negotiating" | "spec_change" | "question" | "generic" | null,
  "confidence": 0.0-1.0
}

כללי כתיבה ל-replyText:
- עברית, RTL, חם, קצר. 1-2 משפטים. WhatsApp message — לא פסקה.
- בלי אימוג'י מוגזמים — 1 לכל היותר.
- אם אתה צריך לאמר משהו שמרגיש דחוף / משמעותי, עדיף escalate.
- שמור על "אנחנו" (לא "אני") בהתייחסות לעסק.

דוגמאות:
- "מה החומר?" → reply: "PP non-woven, פלסטיק נארג עמיד וניתן למחזור. 80gsm רגיל או 100gsm חזק יותר."
- "אקח 1000 כמה יורד?" → reply: "שאלה טובה! הנציג ישקול את זה כשיחזור עם הצעה." kind=negotiating לא רלוונטי כי action=reply.
- "תורידו ב-20%" → escalate, kind=negotiating, analysis="הלקוח רוצה הנחה של 20%", recommendation="להחליט אם להתאים מחיר; אם כן לעדכן את ההצעה."
- "אפשר לדבר?" → escalate, kind=question, analysis="הלקוח מבקש שיחה", recommendation="להתקשר היום."
- "🙏" → noop.`;

export interface UnmatchInput {
  /** Lead's subscriber id — used to load full context. */
  sid: string;
  /** The customer's message that couldn't be classified. */
  message: string;
  /** Optional human-readable label for what kind of unmatch this is. */
  reason?: string;
}

export async function handleUnmatch(
  input: UnmatchInput
): Promise<UnmatchResult> {
  // Kill switch — `LLM_UNMATCH_DISABLED=1` in Vercel envs reverts to the
  // legacy behavior: callers in decision.ts see an "escalate" verdict and
  // fall back to the pre-LLM escalation path. Used for emergency rollback.
  if (envFlag("LLM_UNMATCH_DISABLED")) {
    return {
      action: "escalate",
      kind: "generic",
      llmAnalysis: `LLM unmatch disabled — escalating: "${input.message.slice(0, 120)}"`,
      recommendation: "LLM_UNMATCH_DISABLED=1 — לטפל ידנית עד שיוסר הכיבוי.",
      confidence: 0,
    };
  }
  const text = input.message.trim();
  if (!text) {
    return { action: "noop", confidence: 0, recommendation: "empty message" };
  }

  const ctx = await buildLLMContext(input.sid);
  if (!ctx) {
    // No context = we can't reason. Escalate safely.
    return {
      action: "escalate",
      kind: "generic",
      llmAnalysis: `הבוט לא הצליח לסווג: "${text.slice(0, 120)}"`,
      recommendation: "צריך לבדוק ידנית — הקונטקסט לא נטען.",
      confidence: 0,
    };
  }

  const contextBlock = renderContextForPrompt(ctx);
  const userPrompt = `${contextBlock}

=== ההודעה האחרונה של הלקוח ===
${JSON.stringify(text)}
${input.reason ? `\n=== למה הגענו אליך ===\n${input.reason}` : ""}

החזר JSON לפי הסכמה.`;

  const raw = await callLLM<{
    action?: string;
    replyText?: string | null;
    llmAnalysis?: string | null;
    recommendation?: string | null;
    kind?: string | null;
    confidence?: number;
  }>({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    // Tight budget — Vercel Hobby caps functions at 10s. Previous 12s value
    // exceeded the limit and killed the function before sendBridgeMessage or
    // escalateToEli could run; retries=0 prevents doubling latency.
    timeoutMs: 7000,
    retries: 0,
  });

  if (!raw) {
    // LLM failed — escalate with what we have so the customer isn't ghosted.
    return {
      action: "escalate",
      kind: "generic",
      llmAnalysis: `הבוט לא הצליח לסווג: "${text.slice(0, 120)}"`,
      recommendation: "LLM לא זמין — לבדוק ידנית.",
      confidence: 0,
    };
  }

  return normalize(raw, text);
}

const VALID_ACTIONS = new Set<UnmatchAction>(["reply", "escalate", "noop"]);
const VALID_KINDS = new Set<EscalationKind>([
  "reject",
  "negotiating",
  "spec_change",
  "question",
  "generic",
]);

function normalize(
  raw: {
    action?: string;
    replyText?: string | null;
    llmAnalysis?: string | null;
    recommendation?: string | null;
    kind?: string | null;
    confidence?: number;
  },
  originalMessage: string
): UnmatchResult {
  const action = VALID_ACTIONS.has(raw.action as UnmatchAction)
    ? (raw.action as UnmatchAction)
    : "escalate"; // unknown action → safe default

  const confidence =
    typeof raw.confidence === "number" &&
    raw.confidence >= 0 &&
    raw.confidence <= 1
      ? raw.confidence
      : 0.5;

  const trim = (s: string | null | undefined): string | undefined => {
    if (!s || typeof s !== "string") return undefined;
    const t = s.trim();
    return t ? t : undefined;
  };

  const replyText = trim(raw.replyText);
  let llmAnalysis = trim(raw.llmAnalysis);
  const recommendation = trim(raw.recommendation);
  const kind = VALID_KINDS.has(raw.kind as EscalationKind)
    ? (raw.kind as EscalationKind)
    : undefined;

  // Post-validation — guard against the LLM accidentally citing a price.
  // If it did and we were going to send the reply, downgrade to escalate.
  if (action === "reply" && replyText && containsPriceLike(replyText)) {
    console.warn(
      "[unmatch-agent] reply contained price-like content — downgrading to escalate",
      replyText
    );
    return {
      action: "escalate",
      kind: kind ?? "generic",
      llmAnalysis:
        llmAnalysis ??
        `הבוט ניסה להחזיר תשובה שכוללת מספר/מחיר — מצריך מבט אנושי. הודעת לקוח: "${originalMessage.slice(0, 120)}"`,
      recommendation:
        recommendation ?? "להתקשר ולתאם את המחיר ידנית.",
      confidence,
    };
  }

  if (action === "reply") {
    return {
      action: "reply",
      replyText: replyText ?? "תודה, נציג שלנו יחזור אליך בקרוב.",
      confidence,
    };
  }

  if (action === "escalate") {
    if (!llmAnalysis) {
      llmAnalysis = `הבוט לא הצליח לסווג: "${originalMessage.slice(0, 120)}"`;
    }
    return {
      action: "escalate",
      kind: kind ?? "generic",
      llmAnalysis,
      recommendation,
      confidence,
    };
  }

  return { action: "noop", confidence };
}

// Loose check — does the text quote a number that looks like a price?
// Catches "₪500", "500 ש"ח", "מסביב ל-3500", "1.5 שקל". Anything beyond a
// quantity-like number ("500 יחידות" is fine — that's a quantity).
const PRICE_HINT_RE = /(₪|ש"?ח|שקל|אגורות|nis\b|ils\b)/i;
const NUMBER_RE = /\d{2,}/; // 2+ digit number anywhere
function containsPriceLike(text: string): boolean {
  if (PRICE_HINT_RE.test(text)) return true;
  // Standalone large-ish numbers without a quantity context → suspicious.
  // Allow "1000 יחידות" / "500 שקיות" but flag "1000" alone, "מסביב ל-3500", etc.
  const t = text.toLowerCase();
  if (NUMBER_RE.test(t)) {
    const isQuantityContext = /(יחידות|שקיות|תיקים|פריטים)/.test(t);
    const isPriceContext =
      /(מחיר|עולה|עלות|להוריד|הנחה|זול|יקר|תקציב|תשלום)/.test(t);
    if (!isQuantityContext && isPriceContext) return true;
  }
  return false;
}

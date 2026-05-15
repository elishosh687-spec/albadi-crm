/**
 * Spec extractor — natural-language Hebrew → canonical questionnaire fields.
 *
 * Used in two places (questionnaire.ts):
 *   1. matchAnswer() fallback — when the dumb substring matcher returns null
 *      ("לא חייב" → handles=false, "דחוף" → shipping=s1).
 *   2. Step 8 free-text spec change — customer writes "500 יחידות אקספרס עם
 *      ידיות" → extract all params at once.
 *
 * Returns null on any LLM failure so the caller can fall back to a re-ask /
 * factory route. Soft-fail by design — a flaky LLM never blocks the flow.
 */
import { callLLM } from "./openai-client";

const BOM = "﻿";
function envFlag(key: string): boolean {
  const raw = (process.env[key] ?? "").trim();
  const v = raw.startsWith(BOM) ? raw.slice(1) : raw;
  return v === "1" || v.toLowerCase() === "true";
}

/** Canonical option codes (mirror QUESTIONS in questionnaire.ts). */
export type ShippingCode = "s1" | "s2";
export type QuantityCode = "q0" | "q1" | "q2" | "q3" | "custom";
export type ProductCode = "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "custom";
export type HandlesCode = "true" | "false";
export type LaminationCode = "true" | "false";
export type ColorsCode = "1" | "2" | "3";

export interface ExtractedSpec {
  shipping?: ShippingCode;
  quantity?: QuantityCode;
  /** Free-text quantity when quantity === "custom" (e.g. "7500"). */
  quantityCustom?: string;
  product?: ProductCode;
  /** Free-text dimensions when product === "custom" (e.g. "25×10×35"). */
  productCustom?: string;
  handles?: HandlesCode;
  lamination?: LaminationCode;
  colors?: ColorsCode;
  /** Anything the customer said that doesn't map to a field — passed to Eli. */
  notes?: string;
  /** 0..1 — overall extraction confidence. */
  confidence: number;
}

const SYSTEM_PROMPT = `אתה מחלץ פרמטרים של הזמנת שקיות ממותגות מטקסט עברי חופשי של לקוח.
החזר JSON בלבד עם השדות שנמצאו (השאר חסר אם לא הוזכר).

מבנה התשובה:
{
  "shipping": "s1" | "s2" | null,
  "quantity": "q0" | "q1" | "q2" | "q3" | "custom" | null,
  "quantityCustom": "<string או null אם quantity != custom>",
  "product": "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "custom" | null,
  "productCustom": "<string או null אם product != custom>",
  "handles": "true" | "false" | null,
  "lamination": "true" | "false" | null,
  "colors": "1" | "2" | "3" | null,
  "notes": "<טקסט חופשי שלא נכנס לאף שדה — או null>",
  "confidence": 0.0-1.0
}

מיפויים — shipping (זמן אספקה):
- s1 (אקספרס ~25 יום): "דחוף", "מהר", "אקספרס", "מהיר", "תוך חודש", "תוך 25 יום"
- s2 (רגיל ~90 יום): "לא דחוף", "יש זמן", "רגיל", "3 חודשים", "תוך 90 יום"
- אם הלקוח אמר תאריך ספציפי: ≤25 יום → s1, ≤90 יום → s2

מיפויים — quantity (כמות):
- q0 = 1,000 יחידות (כתוב: "אלף", "1000", "1,000")
- q1 = 3,000 יחידות ("שלושת אלפים", "3000", "3,000")
- q2 = 5,000 יחידות ("חמשת אלפים", "5000", "5,000")
- q3 = 10,000 יחידות ("עשרת אלפים", "10000", "10,000")
- custom = כל מספר אחר (500, 1500, 7500, 2000) → quantityCustom = הטקסט המקורי

מיפויים — product (מידה):
- p1 = 20×8×25 (קוסמטיקה, תכשיטים, קטן)
- p2 = 30×10×30 (ביגוד קל, מתנות, בינוני)
- p3 = 40×12×30 (נעליים, ביגוד)
- p4 = 40×15×50 (פריטים גדולים)
- p5 = 30×40 (שטוחה, פריטים רחבים)
- p6 = 20×15 (קטנה, פריטים קטנים)
- custom = מידות לא סטנדרטיות → productCustom = הטקסט המקורי

מיפויים — handles (ידיות):
- "true": "עם ידיות", "כן", "חייב ידיות", "צריך ידיות", "כן בטח", "ידיות חבל/קרטון"
- "false": "בלי ידיות", "אין צורך", "לא חייב", "לא צריך", "ללא ידיות"

מיפויים — lamination (למינציה):
- "true": "עם למינציה", "כן", "חשוב לי", "יוקרתי", "מבריק"
- "false": "בלי למינציה", "לא צריך", "מט", "פשוט", "רגיל"

מיפויים — colors (צבעי הדפסה):
- "1": "צבע אחד", "שחור", "מונוכרום", "שחור-לבן"
- "2": "שני צבעים", "2 צבעים", "שחור ולבן ועוד"
- "3": "שלושה צבעים", "3 צבעים"
- (פול קולור / CMYK → notes, לא בשדה — לא סטנדרטי)

כללים:
- אל תנחש. ערפול → השאר null + ציין ב-notes.
- "תלוי במחיר" / "מה ההמלצה שלך" → השאר השדה null, ציין ב-notes.
- כל טקסט שלא נכנס לשדה → notes (לדוגמה: "אני צריך לתערוכה", "השאר את הצבעים מקסימליים").
- confidence: 0.9+ אם השפה ברורה לגמרי, 0.7 אם דרשה פרשנות, <0.5 אם מעורפל.`;

export interface ExtractInput {
  /** The customer's free-text message. */
  text: string;
  /** Optional rendered context (history + qState) from llm-context.ts. */
  context?: string;
}

export async function extractSpecFromText(
  input: ExtractInput
): Promise<ExtractedSpec | null> {
  // Kill switch — `LLM_SPEC_EXTRACTOR_DISABLED=1` in Vercel envs disables the
  // LLM entirely and falls callers back to the deterministic matchAnswer /
  // factory route. Used for emergency rollback (~30s with redeploy).
  if (envFlag("LLM_SPEC_EXTRACTOR_DISABLED")) {
    return null;
  }
  const text = input.text.trim();
  if (!text) return null;

  const userPrompt = input.context
    ? `${input.context}\n\n=== הודעה לניתוח ===\n${JSON.stringify(text)}\n\nחלץ ל-JSON.`
    : `הודעת הלקוח: ${JSON.stringify(text)}\n\nחלץ ל-JSON.`;

  const raw = await callLLM<{
    shipping?: string | null;
    quantity?: string | null;
    quantityCustom?: string | null;
    product?: string | null;
    productCustom?: string | null;
    handles?: string | null;
    lamination?: string | null;
    colors?: string | null;
    notes?: string | null;
    confidence?: number;
  }>({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    // Tight budget — Vercel Hobby kills functions at 10s. Leave headroom for
    // DB writes + sendBridgeMessage after this call returns. A retry doubles
    // latency and risks function termination, so retries=0.
    timeoutMs: 7000,
    retries: 0,
  });

  if (!raw) return null;
  return normalize(raw);
}

const SHIPPING_VALUES = new Set(["s1", "s2"]);
const QUANTITY_VALUES = new Set(["q0", "q1", "q2", "q3", "custom"]);
const PRODUCT_VALUES = new Set(["p1", "p2", "p3", "p4", "p5", "p6", "custom"]);
const HANDLES_VALUES = new Set(["true", "false"]);
const LAMINATION_VALUES = new Set(["true", "false"]);
const COLORS_VALUES = new Set(["1", "2", "3"]);

function pick<T extends string>(
  raw: string | null | undefined,
  allowed: Set<T>
): T | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  return allowed.has(v as T) ? (v as T) : undefined;
}

function pickString(raw: string | null | undefined): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t ? t : undefined;
}

function normalize(raw: {
  shipping?: string | null;
  quantity?: string | null;
  quantityCustom?: string | null;
  product?: string | null;
  productCustom?: string | null;
  handles?: string | null;
  lamination?: string | null;
  colors?: string | null;
  notes?: string | null;
  confidence?: number;
}): ExtractedSpec {
  const out: ExtractedSpec = {
    confidence:
      typeof raw.confidence === "number" &&
      raw.confidence >= 0 &&
      raw.confidence <= 1
        ? raw.confidence
        : 0.5,
  };

  const shipping = pick(raw.shipping, SHIPPING_VALUES as Set<ShippingCode>);
  if (shipping) out.shipping = shipping;

  const quantity = pick(raw.quantity, QUANTITY_VALUES as Set<QuantityCode>);
  if (quantity) {
    out.quantity = quantity;
    if (quantity === "custom") {
      const qc = pickString(raw.quantityCustom);
      if (qc) out.quantityCustom = qc;
    }
  }

  const product = pick(raw.product, PRODUCT_VALUES as Set<ProductCode>);
  if (product) {
    out.product = product;
    if (product === "custom") {
      const pc = pickString(raw.productCustom);
      if (pc) out.productCustom = pc;
    }
  }

  const handles = pick(raw.handles, HANDLES_VALUES as Set<HandlesCode>);
  if (handles) out.handles = handles;

  const lamination = pick(raw.lamination, LAMINATION_VALUES as Set<LaminationCode>);
  if (lamination) out.lamination = lamination;

  const colors = pick(raw.colors, COLORS_VALUES as Set<ColorsCode>);
  if (colors) out.colors = colors;

  const notes = pickString(raw.notes);
  if (notes) out.notes = notes;

  return out;
}

/**
 * Quick check — did the extraction find anything useful?
 * Used by matchAnswer fallback to decide whether to accept the LLM's reading
 * or fall back to re-ask.
 */
export function hasAnyField(spec: ExtractedSpec): boolean {
  return Boolean(
    spec.shipping ||
      spec.quantity ||
      spec.product ||
      spec.handles ||
      spec.lamination ||
      spec.colors ||
      spec.notes
  );
}

/**
 * Classify a customer's reply to the confirmation gate (step 9): is it a
 * "proceed" ("הכל בסדר, תשלח לי הצעה"), a "change" ("שניה, תחליף את הכמות"),
 * or unintelligible? Used after the regex/keyword pass fails. Soft-fails to
 * null so the caller can ambiguity-cap + route-to-factory.
 */
export async function classifyConfirmation(
  text: string
): Promise<"proceed" | "change" | null> {
  const clean = text.trim();
  if (!clean) return null;
  const result = await callLLM<{
    intent?: "proceed" | "change" | "unknown";
    confidence?: number;
  }>({
    system:
      "אתה מסווג תגובה של לקוח לשאלת אישור על הזמנה של שקיות. החזר JSON עם " +
      '`intent` ("proceed" אם הוא מאשר את ההזמנה ורוצה לקבל מחיר, "change" אם ' +
      'הוא רוצה לשנות משהו בפרטים, "unknown" אם לא ברור) ו-`confidence` ' +
      "(0..1). שום טקסט נוסף.",
    user: clean,
    temperature: 0,
    timeoutMs: 5000,
  });
  if (!result || !result.intent) return null;
  if (result.intent === "unknown") return null;
  if (typeof result.confidence === "number" && result.confidence < 0.55) {
    return null;
  }
  return result.intent;
}

/**
 * Extract a single field — for matchAnswer fallback in questionnaire.ts.
 * Returns the canonical option code (e.g. "true" for handles, "s1" for
 * shipping) if the LLM confidently extracted it; otherwise null.
 */
export async function extractSingleField(
  text: string,
  field: "shipping" | "quantity" | "product" | "handles" | "lamination" | "colors",
  minConfidence = 0.7
): Promise<{ value: string; quantityCustom?: string; productCustom?: string } | null> {
  const spec = await extractSpecFromText({ text });
  if (!spec) return null;
  if (spec.confidence < minConfidence) return null;
  const value = spec[field];
  if (typeof value !== "string") return null;
  const result: { value: string; quantityCustom?: string; productCustom?: string } = {
    value,
  };
  if (field === "quantity" && spec.quantity === "custom" && spec.quantityCustom) {
    result.quantityCustom = spec.quantityCustom;
  }
  if (field === "product" && spec.product === "custom" && spec.productCustom) {
    result.productCustom = spec.productCustom;
  }
  return result;
}

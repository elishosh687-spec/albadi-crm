/**
 * WhatsApp bag-quote questionnaire — direct port of the ManyChat Flow
 * documented at bag-quote-app/docs/manychat-flow.html, extended with:
 *   - "אחר" (custom) options on quantity (Q2) and product (Q3)
 *   - Custom-spec branch routes to FACTORY_WAIT (subFlow=awaiting_factory_estimate) + NEEDS_ELI + Eli DM at end
 *   - Standard path triggers INTAKE (subFlow=awaiting_estimate_decision) sub-flow (handled in decision.ts)
 *
 * State machine:
 *   step 3: asked shipping
 *   step 4: asked quantity (option 5 = "אחר" → free-text capture in same step)
 *   step 5: asked product  (option 7 = "אחר" → free-text capture in same step)
 *   step 8: asked colors
 *   step 9: confirmation gate
 *   step 10: done
 *
 * Note: steps 6 (handles) and 7 (lamination) were retired — data showed 100%
 * answered "with handles" and customers can override the "without lamination"
 * default at the step-9 free-text revision. Defaults are injected on the
 * transition to step 9 (see HANDLES_DEFAULT / LAMINATION_DEFAULT).
 *
 * Custom branches set q_state.pendingCustomField — on the next inbound the
 * text is stored in q_state.{field}Custom and the flow advances normally.
 */
import { db } from "../db";
import { leads } from "../../drizzle/schema";
import { sql } from "drizzle-orm";
import { sendBridgeMessage, sendCompanyTemplate } from "../bridge/client";
import { sendEliDM } from "../notify/eli";
import { calculateQuoteByCodes } from "../factory/calculator";
import { buildQuoteMessage } from "../factory/calculator/message";
import {
  isOverCbmConsolidationThreshold,
  cbmConsolidationAlert,
} from "../factory/sea-carriers";
import {
  extractSpecFromText,
  extractSingleField,
  classifyConfirmation,
  type ExtractedSpec,
} from "./spec-extractor";
import { buildLLMContext, renderContextForPrompt } from "./llm-context";
import { logBotQuote } from "./quote-log";

type ListOption = { value: string; label: string };

interface Question {
  step: number;
  field: "shipping" | "quantity" | "product" | "handles" | "lamination" | "colors";
  prompt: string;
  options: ListOption[];
  /** When true, picking the last option triggers a free-text capture in the same step. */
  hasCustom?: boolean;
  /** Prompt the bot sends when waiting on the free-text custom value. */
  customPrompt?: string;
  /** When true and option count ≤ 3, send as WhatsApp buttons instead of a numbered text list. */
  buttons?: boolean;
}

export const OPENING =
  "שלום! 👋 אני אעזור לך לקבל הצעת מחיר מיידית לשקיות ממותגות. זה ייקח כ-2 דקות 😊";

const QUESTIONS: Question[] = [
  {
    step: 3,
    field: "shipping",
    prompt: "🚚 שיטת משלוח?",
    options: [
      { value: "s1", label: "✈️ אקספרס (~25 יום)" },
      { value: "s2", label: "🚢 רגיל (~90 יום)" },
    ],
    buttons: true,
  },
  {
    step: 4,
    field: "quantity",
    prompt: "📦 כמה יחידות אתם צריכים?",
    options: [
      // q0 (1,000 יחידות) hidden 2026-06-17 — 1,000-unit orders no longer
      // offered; minimum is 3,000. Decode map (qstate-decode q0:1000) is kept
      // for back-compat with in-flight leads. To re-offer: restore this line.
      // { value: "q0", label: "1,000 יחידות" },
      { value: "q1", label: "3,000 יחידות" },
      { value: "q2", label: "5,000 יחידות" },
      { value: "q3", label: "10,000 יחידות" },
      { value: "custom", label: "אחר / כמות מותאמת" },
    ],
    hasCustom: true,
    customPrompt:
      "כמה יחידות אתם צריכים? תכתבו את הכמות בדיוק — לדוגמה 7500.",
  },
  {
    step: 5,
    field: "product",
    prompt: "📐 איזה גודל שקית? (H=גובה, D=עומק, W=רוחב, בס״מ)",
    options: [
      { value: "p1", label: "H20*D8*W25 — קוסמטיקה, תכשיטים" },
      { value: "p2", label: "H30*D10*W30 — ביגוד קל, מתנות" },
      { value: "p3", label: "H30*D12*W40 — נעליים, ביגוד" },
      { value: "p4", label: "H40*D15*W50 — פריטים גדולים" },
      { value: "p5", label: "H30*W40 — שטוח רחב" },
      { value: "p6", label: "H15*W20 — שטוח קטן" },
      { value: "more", label: "📐 צריך מידה אחרת" },
    ],
    hasCustom: true,
    customPrompt:
      "מה המידות שאתם צריכים? פורמט המפעל: גובה × עומק × רוחב (בס״מ).\nדוגמה: H40*D15*W50 (גובה 40, עומק 15, רוחב 50).\nאם אין עומק (שקית שטוחה) — תכתבו רק גובה ורוחב, למשל H30*W40.",
  },
  {
    step: 8,
    field: "colors",
    prompt: "🎨 כמה צבעים בלוגו?",
    options: [
      { value: "1", label: "צבע אחד" },
      { value: "2", label: "2 צבעים" },
      { value: "3", label: "3 צבעים" },
    ],
    buttons: true,
  },
];


// Step-5 "page 2" — shown when the customer picks "צריך מידה אחרת" from the
// initial list of 6 popular sizes. Same field/step as the page-1 question;
// only the option set differs. `getCurrentQuestion()` picks the right page
// based on qState.sizePage.
const PRODUCT_QUESTION_PAGE_2: Question = {
  step: 5,
  field: "product",
  prompt: "📐 מידות נוספות:",
  options: [
    { value: "p7", label: "H15*D5*W20 — קטן צר, יוקרה" },
    { value: "p8", label: "H35*D10*W40 — בינוני-גדול" },
    { value: "p9", label: "H40*D15*W45 — גדול" },
    { value: "p12", label: "H10*W15 — שטוח קטן" },
    { value: "p13", label: "H25*W25 — ריבועי" },
    { value: "custom", label: "אחר / מידה מותאמת" },
  ],
  hasCustom: true,
  customPrompt:
    "מה המידות שאתם צריכים? פורמט המפעל: גובה × עומק × רוחב (בס״מ).\nדוגמה: H40*D15*W50 (גובה 40, עומק 15, רוחב 50).\nאם אין עומק (שקית שטוחה) — תכתבו רק גובה ורוחב, למשל H30*W40.",
};

function getCurrentQuestion(qState: { step: number; sizePage?: 1 | 2 }): Question | null {
  if (qState.step === 5 && qState.sizePage === 2) return PRODUCT_QUESTION_PAGE_2;
  return QUESTIONS.find((q) => q.step === qState.step) ?? null;
}

// Step numbers are sparse (3,4,5,8) after retiring handles/lamination — find
// the next question by step ordering, not strict +1 increment. Returns
// `undefined` when `currentStep` is past the last question.
function findNextQuestion(currentStep: number): Question | undefined {
  return QUESTIONS.filter((q) => q.step > currentStep).sort((a, b) => a.step - b.step)[0];
}

// Defaults injected when the questionnaire transitions to step 9 (confirmation
// gate). Customers who want a different value can say so in the "רוצה לשנות"
// free-text revision — spec-extractor parses it and merges back into qState.
const HANDLES_DEFAULT = "true"; // 100% of past customers chose "with handles"
const LAMINATION_DEFAULT = "false"; // business choice — cheaper default; customer can upgrade in revision

function applyRetiredFieldDefaults(state: QState): QState {
  return {
    ...state,
    handles: state.handles ?? HANDLES_DEFAULT,
    lamination: state.lamination ?? LAMINATION_DEFAULT,
  };
}

const DECISION_PROMPT =
  "מה דעתכם על ההצעה?\n\n✅ מתאים → שלחו לנו את הלוגו ונמשיך.\n🔧 רוצים לשנות משהו?";

// Sent immediately after the quote so the customer has trust-building
// context (who we are, where to verify us) before they decide. Also
// re-sent on-demand when the intent classifier flags `question_company`
// in decision.ts. WA renders each URL as a tappable link-preview card,
// so no buttons needed.
export const COMPANY_TEMPLATE =
  "👋 *קצת עלינו — אלבדי*\n\n" +
  "חברת אריזות עם 20+ שנה בענף. שותפים במפעל ייצור בסין. מתמחים בשקיות ממותגות לעסקים.\n\n" +
  "🌐 https://ecobrotherss.com\n\n" +
  "🌐 https://packiure.com\n\n" +
  "🌐 https://albadi.ecobrotherss.com\n\n" +
  "📸 אינסטגרם: https://www.instagram.com/simonsostri";
const FACTORY_HOLD_MSG =
  "תודה, קיבלתי את המפרט. חוזר אליכם תוך 24-48 שעות עם המחיר.";
const BAIL_REPLY =
  "רגע, נראה לי שעדיף שננהל את זה בטלפון. אחזור אליכם תוך 24 שעות עם המחיר.";
const REASK_REPLIES = [
  // attempt #1 (unmatched=1)
  "🤔 לא הצלחתי להבין. אפשר לבחור מספר מהרשימה?",
  // attempt #2 (unmatched=2) — softer, blames Eli's phrasing
  "אני עדיין לא קולט — אולי הניסוח שלי לא ברור. תכתבו מספר מהרשימה, או רק את שם האפשרות.",
];

// Step-9 confirmation copy. The flow: customer sees a summary of every
// field they answered, then chooses to proceed or revise. "רוצה לשנות"
// opens free-text capture that spec-extractor LLM parses back into qState.
const CONFIRM_FREETEXT_PROMPT =
  "תכתוב מה תרצה לשנות או להוסיף — אפשר חופשי, בעברית.\nלמשל: 'במקום 5000 תהיה 2000', 'מידה אחרת', 'הערה לתערוכה'.";
const CONFIRM_NOTHING_EXTRACTED =
  "לא הצלחתי להבין מה לשנות. אפשר לכתוב שוב? לדוגמה: 'כמות 2000', '30×40 ס\"מ', 'בלי ידיות'.";
const CONFIRM_AFTER_CHANGE_NOTE =
  "סבבה, עדכנתי. הנה המפרט עכשיו:";
const CONFIRM_MAX_ATTEMPTS_MSG =
  "תודה על הפרטים — נראה שהמפרט מצריך תיאום ידני. אלי יחזור אליכם תוך 24-48 שעות.";

const CONFIRM_OPTION_PROCEED = "מעולה, נמשיך";
const CONFIRM_OPTION_CHANGE = "רוצה לשנות";
const CONFIRM_AMBIGUOUS_BAIL_MSG =
  "תודה — לא הצלחתי לוודא אם להמשיך או לשנות. אעדכן את אלי שיחזור אליכם תוך 24 שעות.";

const CONFIRMATION_QUESTION: Question = {
  step: 9,
  // `confirmation` isn't a real field — it's a marker so matchAnswer can pick
  // the proceed/change button. The handler in handleInbound branches on
  // confirmationStep, not on this synthetic field.
  field: "shipping" /* placeholder — never read for confirmation */,
  // Used as the poll question when POLLS_ENABLED. The full summary body is
  // sent as a preceding text message via buildConfirmationMessage.
  prompt: "הכל בסדר, או רוצים לשנות משהו?",
  options: [
    { value: "proceed", label: CONFIRM_OPTION_PROCEED },
    { value: "change", label: CONFIRM_OPTION_CHANGE },
  ],
  buttons: true,
};

export interface QState {
  step: number;
  shipping?: string;
  quantity?: string;
  product?: string;
  handles?: string;
  lamination?: string;
  colors?: string;
  quantityCustom?: string;
  productCustom?: string;
  pendingCustomField?: "quantity" | "product" | null;
  quoteResult?: string;
  bailed?: boolean;
  unmatchedAt?: number;
  doneAt?: string;
  routedToFactory?: boolean;
  // Page index inside step 5 (product). 1 = popular 6 sizes + "more". 2 =
  // remaining 8 + custom. Set when the customer picks "צריך מידה אחרת".
  sizePage?: 1 | 2;

  // Step 9 — confirmation gate after the last question. The customer sees a
  // summary + buttons ("מעולה, נמשיך" / "רוצה לשנות"). On "רוצה לשנות" the
  // bot opens a free-text field; spec-extractor parses it and merges into
  // qState before re-showing the summary. After confirmationAttempts >= 2
  // the lead routes to factory (Eli prices manually) to avoid loops.
  confirmationStep?: "awaiting_confirm" | "awaiting_freetext" | null;
  confirmationAttempts?: number;
  // Bumped each time we can't classify the customer's confirmation reply as
  // proceed/change (after matchAnswer + regex + LLM all fail). After 2
  // strikes we route to factory + DM Eli — prevents infinite loops on
  // off-script replies like "?", "מה?", "...".
  confirmationAmbiguous?: number;
  // INTAKE (subFlow=awaiting_estimate_decision) sub-state `awaiting_spec_change` re-prompt
  // counter. Bumped when the customer's reply to "מה רוצים לשנות?" doesn't
  // contain any extractable field. After 2 strikes the lead is escalated.
  specChangeAttempts?: number;
  orderNotes?: string;
}

function formatQuestion(q: Question): string {
  // When polls are enabled, send only the prompt — the poll renders the
  // option chips itself. Same for legacy buttons. Otherwise render the full
  // numbered list so the customer can reply with a number or substring.
  if (POLLS_ENABLED || (!BUTTONS_DISABLED && q.buttons)) {
    return q.prompt;
  }
  const lines = [q.prompt, ""];
  q.options.forEach((opt, i) => {
    lines.push(`${i + 1}. ${opt.label}`);
  });
  lines.push("");
  lines.push("השב במספר (1, 2, ...) או בטקסט.");
  return lines.join("\n");
}

// Native WhatsApp polls. Vote replies arrive as message.received with
// data.media_type="poll_vote"; webhook unwraps `selected_options[0]` so the
// flow sees the option label as if the customer typed it. Single-select
// (selectable_count=1). Free-text follow-up still triggers when the customer
// picks "אחר".
const POLLS_ENABLED = true;

// Legacy interactive buttons kill-switch — kept for fallback if polls ever
// regress. Taps via `type=buttons` do not round-trip on iOS, so this stays
// true; the poll path supersedes it.
const BUTTONS_DISABLED = true;

function buildPoll(q: Question): { question: string; options: string[] } | null {
  if (!POLLS_ENABLED) return null;
  if (q.options.length < 2 || q.options.length > 12) return null;
  // Strip leading emojis from labels — WhatsApp shows them but they crowd
  // the poll UI on small screens. matchAnswer accepts the cleaned label
  // because its substring match is case-insensitive over `label`.
  const options = q.options.map((opt) =>
    opt.label.replace(/^[\p{Extended_Pictographic}\s]+/u, "").trim()
  );
  return { question: q.prompt, options };
}

function buildButtons(q: Question): { id: string; title: string }[] | null {
  if (BUTTONS_DISABLED) return null;
  if (!q.buttons) return null;
  // Drop "custom" so the bridge stays under WhatsApp's 3-button cap and so
  // free-text branches still route through the explicit prompt path.
  const visible = q.options.filter((opt) => opt.value !== "custom");
  if (visible.length === 0 || visible.length > 3) return null;
  return visible.map((opt) => ({
    id: opt.value,
    // WA caps button titles at 20 chars. Strip leading emojis to save space.
    title: opt.label.replace(/^[\p{Extended_Pictographic}\s]+/u, "").slice(0, 20),
  }));
}

async function askQuestion(recipient: string, q: Question): Promise<void> {
  const poll = buildPoll(q);
  const btns = poll ? null : buildButtons(q);
  await sendBridgeMessage(
    recipient,
    formatQuestion(q),
    undefined,
    "bot",
    undefined,
    btns ?? undefined,
    poll ?? undefined
  );
}

// --- step 9 confirmation helpers ---

const SHIP_LABEL: Record<string, string> = {
  s1: "אקספרס (~25 יום)",
  s2: "רגיל (~90 יום)",
};
const QTY_LABEL: Record<string, string> = {
  q0: "1,000",
  q1: "3,000",
  q2: "5,000",
  q3: "10,000",
};
// Display labels mirror the canonical factory format from
// lib/factory/calculator/constants.ts (`H{height}*D{depth}*W{width}`).
const PROD_LABEL: Record<string, string> = {
  p1: "H20*D8*W25 ס״מ",
  p2: "H30*D10*W30 ס״מ",
  p3: "H30*D12*W40 ס״מ",
  p4: "H40*D15*W50 ס״מ",
  p5: "H30*W40 ס״מ",
  p6: "H15*W20 ס״מ",
  p7: "H15*D5*W20 ס״מ",
  p8: "H35*D10*W40 ס״מ",
  p9: "H40*D15*W45 ס״מ",
  p12: "H10*W15 ס״מ",
  p13: "H25*W25 ס״מ",
};

function buildConfirmationMessage(state: QState): string {
  const qty =
    state.quantity === "custom"
      ? state.quantityCustom || "אחר"
      : QTY_LABEL[state.quantity ?? ""] ?? state.quantity ?? "?";
  const prod =
    state.product === "custom"
      ? state.productCustom || "מידה מיוחדת"
      : PROD_LABEL[state.product ?? ""] ?? state.product ?? "?";
  const ship = SHIP_LABEL[state.shipping ?? ""] ?? state.shipping ?? "?";
  const handles = state.handles === "true" ? "כן" : "לא";
  const lamination = state.lamination === "true" ? "כן" : "לא";

  const lines = [
    "הנה הפרטים שאספנו:",
    `📦 כמות: ${qty}`,
    `📐 מידה: ${prod}`,
    `🚚 משלוח: ${ship}`,
    `🛍️ ידיות: ${handles}`,
    `✨ למינציה: ${lamination}`,
    `🎨 צבעי הדפסה: ${state.colors ?? "?"}`,
  ];
  if (state.orderNotes) {
    lines.push(`📝 הערות: ${state.orderNotes}`);
  }
  // When polls are enabled the confirmation prompt + options live in the
  // poll itself, so the body stays summary-only. When polls AND buttons are
  // both off, fall back to the legacy numbered tail so the customer knows
  // what to type.
  if (POLLS_ENABLED) {
    return lines.join("\n");
  }
  lines.push("", "הכל בסדר, או רוצים לשנות משהו?");
  if (BUTTONS_DISABLED) {
    lines.push(
      "",
      `1. ${CONFIRM_OPTION_PROCEED}`,
      `2. ${CONFIRM_OPTION_CHANGE}`,
      "השב במספר (1, 2) או בטקסט."
    );
  }
  return lines.join("\n");
}

/**
 * Merge LLM-extracted fields into the current qState. Fields present in
 * `extracted` overwrite the existing values. `notes` is APPENDED (not
 * replaced) to orderNotes so a customer can add multiple comments across
 * rounds. Returns whether at least one field actually changed.
 */
export function mergeExtracted(
  state: QState,
  extracted: ExtractedSpec
): { merged: QState; changed: boolean } {
  const merged: QState = { ...state };
  let changed = false;

  if (extracted.shipping && extracted.shipping !== state.shipping) {
    merged.shipping = extracted.shipping;
    changed = true;
  }
  if (extracted.quantity && extracted.quantity !== state.quantity) {
    merged.quantity = extracted.quantity;
    if (extracted.quantity === "custom") {
      merged.quantityCustom = extracted.quantityCustom ?? merged.quantityCustom;
    } else {
      merged.quantityCustom = undefined;
    }
    changed = true;
  } else if (
    extracted.quantity === "custom" &&
    extracted.quantityCustom &&
    extracted.quantityCustom !== state.quantityCustom
  ) {
    merged.quantityCustom = extracted.quantityCustom;
    changed = true;
  }
  if (extracted.product && extracted.product !== state.product) {
    merged.product = extracted.product;
    if (extracted.product === "custom") {
      merged.productCustom = extracted.productCustom ?? merged.productCustom;
    } else {
      merged.productCustom = undefined;
    }
    changed = true;
  } else if (
    extracted.product === "custom" &&
    extracted.productCustom &&
    extracted.productCustom !== state.productCustom
  ) {
    merged.productCustom = extracted.productCustom;
    changed = true;
  }
  if (extracted.handles && extracted.handles !== state.handles) {
    merged.handles = extracted.handles;
    changed = true;
  }
  if (extracted.lamination && extracted.lamination !== state.lamination) {
    merged.lamination = extracted.lamination;
    changed = true;
  }
  if (extracted.colors && extracted.colors !== state.colors) {
    merged.colors = extracted.colors;
    changed = true;
  }
  if (extracted.notes) {
    const note = extracted.notes.trim();
    if (note) {
      merged.orderNotes = state.orderNotes
        ? `${state.orderNotes}\n${note}`
        : note;
      changed = true;
    }
  }
  return { merged, changed };
}

function matchAnswer(text: string, q: Question): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
    return q.options[n - 1].value;
  }
  for (const opt of q.options) {
    if (opt.value.toLowerCase() === t) return opt.value;
  }
  for (const opt of q.options) {
    if (opt.label.toLowerCase().includes(t) || t.includes(opt.value.toLowerCase())) {
      return opt.value;
    }
  }
  return null;
}

/**
 * Parse a customer's free-text custom-quantity into a positive integer.
 * Returns null when the string has no parseable digits.
 *
 * Spec-extractor LLM is instructed to write the canonical number into
 * `quantityCustom` (e.g. "אלפיים" → "2000"), so most inputs are clean digit
 * strings. This function also strips non-digit noise as a safety net for
 * pre-prompt-update rows and direct ManyChat-legacy paths.
 */
export function parseCustomQuantity(raw?: string | null): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Decide whether a completed questionnaire must wait for Eli to price it
 * manually (factory route), or whether the in-process calculator can quote
 * it directly.
 *
 * Rules:
 *   - Custom dimensions → always factory. Calculator has no pricing curve
 *     for arbitrary box sizes.
 *   - Custom quantity that parses to ≥ 3000 → calculator. It already snaps
 *     down to the nearest tier price via `findClosestPrice`, so 4000 →
 *     tier-3000 unit price × 4000 units. No human needed.
 *   - Custom quantity < 3000 or unparseable → factory. Below tier floor.
 *     (Floor raised from 1000 → 3000 on 2026-06-17 when the 1,000-unit tier
 *     was retired from customer selection.)
 */
export function shouldRouteToFactory(state: QState): boolean {
  if (state.product === "custom") return true;
  if (state.quantity === "custom") {
    const n = parseCustomQuantity(state.quantityCustom);
    if (n === null || n < 3000) return true;
  }
  return false;
}

export interface QuoteCalcOutput {
  text: string;
  totalIls: number;
  altTotalIls: number | null;
  /** Total shipment volume (CBM) — used for the internal >7 CBM signal. */
  cbm: number;
}

async function fetchQuote(state: QState): Promise<QuoteCalcOutput> {
  // Local calculator (ported from bag-quote-app). No HTTP roundtrip.
  if (!state.product || !state.quantity || !state.shipping) {
    throw new Error(
      `calc missing required state: product=${state.product} quantity=${state.quantity} shipping=${state.shipping}`
    );
  }
  const hasLamination = state.lamination === "true";
  // For custom quantity inside the tier range, pass the literal number as
  // `quantityOverride`. The engine snaps the unit price down to the nearest
  // tier via findClosestPrice but multiplies by the actual customer quantity.
  // For tier-based quantity (q0..q3), leave override null.
  const customQty =
    state.quantity === "custom"
      ? parseCustomQuantity(state.quantityCustom)
      : null;
  const calc = await calculateQuoteByCodes({
    productId: state.product,
    quantityTierId: state.quantity,
    quantityOverride: customQty,
    hasHandles: state.handles === "true",
    logoColors: Number(state.colors) || 1,
    hasLamination,
    shippingOptionId: state.shipping,
  });
  if (!calc) {
    throw new Error(
      `calc failed for state=${JSON.stringify({
        product: state.product,
        quantity: state.quantity,
        shipping: state.shipping,
      })}`
    );
  }
  const text = buildQuoteMessage({
    dimensions: calc.result.product?.dimensions ?? "",
    hasHandles: calc.result.hasHandles,
    hasLamination,
    quantity: calc.result.quantity,
    logoColors: calc.result.logoColors,
    shippingName: calc.result.shippingOption?.name ?? "",
    shippingDays: calc.result.shippingOption?.deliveryDays ?? "",
    pricePerUnit: calc.result.sellingPricePerUnitIls,
    totalOrder: calc.result.totalOrderPriceIls,
    currency: calc.result.currency,
    appUrl: "https://albadi.ecobrotherss.com",
    alt: calc.altResult
      ? {
          shippingName: calc.altResult.shippingOption?.name ?? "",
          shippingDays: calc.altResult.shippingOption?.deliveryDays ?? "",
          pricePerUnit: calc.altResult.sellingPricePerUnitIls,
          totalOrder: calc.altResult.totalOrderPriceIls,
        }
      : null,
  });
  return {
    text,
    totalIls: calc.result.totalOrderPriceIls,
    altTotalIls: calc.altResult?.totalOrderPriceIls ?? null,
    cbm: calc.result.totalCbm,
  };
}

async function saveState(sid: string, state: QState): Promise<void> {
  await db
    .update(leads)
    .set({ qState: state as any, updatedAt: new Date() })
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`);
}

interface LeadCtx {
  sid: string;
  jid: string;
  name: string | null;
  phone: string | null;
  pipelineStage: string | null;
  qState: QState | null;
}

/**
 * Initialize questionnaire state for a lead whose OPENING was already sent
 * externally (e.g. facebook-import). Saves initial qState and asks the first
 * question without re-sending OPENING.
 */
export async function kickstartQuestionnaire(sid: string): Promise<void> {
  const ctx = await loadLeadCtx(sid);
  if (!ctx) return;
  if (ctx.qState) return; // already started — don't overwrite
  const first = QUESTIONS[0];
  const newState: QState = { step: first.step };
  await saveState(sid, newState);
  await askQuestion(ctx.jid, first);
}

/**
 * Treat a lead as brand new: clear every bot-side field that survives across
 * runs (FSM state, follow-up bookkeeping, draft factory spec, pipeline stage,
 * cached money figures, summary, loss reason) and then re-trigger the
 * questionnaire from question 1. Conversation history in `messages` is left
 * alone so context isn't destroyed. Used by the GHL "restart questionnaire"
 * tag webhook.
 */
export async function resetLeadAndRestart(
  sid: string,
  transitionText?: string
): Promise<void> {
  const ctx = await loadLeadCtx(sid);
  if (!ctx) throw new Error("lead not found");
  await db
    .update(leads)
    .set({
      factorySpecDraft: null,
      pipelineStage: null,
      pipelineFlag: null,
      botSummary: null,
      quoteTotal: null,
      quoteAlt: null,
      followUpDate: null,
      followUpCount: 0,
      lossReason: null,
      nextAction: null,
      botPaused: false,
      lastFollowUpAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
  await restartQuestionnaire(
    sid,
    transitionText ?? "מתחילים מחדש 🙂 בואו נמלא יחד שאלון קצר כדי לבנות לך הצעת מחיר."
  );
}

/**
 * Force-restart the questionnaire from the first question (shipping). Resets
 * qState, sends a transition note + OPENING + the first poll. Safe to invoke
 * mid-flow — the new state overrides whatever step the lead was on. Used by
 * the CRM "restart questionnaire" template.
 */
export async function restartQuestionnaire(
  sid: string,
  transitionText?: string
): Promise<void> {
  const ctx = await loadLeadCtx(sid);
  if (!ctx) throw new Error("lead not found");
  const recipient =
    ctx.jid ??
    (ctx.phone
      ? `${ctx.phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`
      : ctx.sid);
  const first = QUESTIONS[0];
  const newState: QState = { step: first.step };
  // pipelineStage must go back to NULL so the questionnaire FSM
  // (handleInbound) accepts the customer's next reply — otherwise the
  // decision-stage handler grabs the inbound first and intent-classifies it
  // (e.g. "רגיל ~90 יום" → question_delivery → canned reply instead of
  // advancing the poll). Prior business data (factory draft, quote totals,
  // bot summary, follow-up date, loss reason) is preserved intentionally so
  // the customer's re-quote keeps full history.
  await db
    .update(leads)
    .set({
      qState: newState as any,
      pipelineStage: null,
      pipelineFlag: null,
      botPaused: false,
      followUpCount: 0,
      lastFollowUpAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
  const transition =
    transitionText?.trim() ||
    "סליחה על הבלבול קודם 🙏 בואו נתחיל את השאלון מההתחלה.";
  await sendBridgeMessage(recipient, transition);
  await new Promise((r) => setTimeout(r, 800));
  await sendBridgeMessage(recipient, OPENING);
  await new Promise((r) => setTimeout(r, 800));
  await askQuestion(recipient, first);
}

export async function loadLeadCtx(sid: string): Promise<LeadCtx | null> {
  const [row] = await db
    .select({
      sid: leads.manychatSubId,
      jid: leads.waJid,
      name: leads.name,
      phone: leads.phoneE164,
      pipelineStage: leads.pipelineStage,
      qState: leads.qState,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  if (!row) return null;
  // Prefer waJid, then phone→JID. Never fall back to sid: for ManyChat-origin
  // leads sid is a subscriber id, not a phone, so phoneToJid(sid) would synth
  // a non-existent JID and sends would silently route to nowhere.
  const jid = row.jid ?? (row.phone ? `${row.phone.replace(/[^0-9]/g, "")}@s.whatsapp.net` : null);
  if (!jid) return null;
  return {
    sid: row.sid,
    jid,
    name: row.name,
    phone: row.phone,
    pipelineStage: row.pipelineStage,
    qState: (row.qState as QState | null) ?? null,
  };
}

function summarizeForFactory(state: QState, name: string | null, phone: string | null): string {
  const who = name?.trim() || phone || "ליד";
  const shipMap: Record<string, string> = {
    s1: "אקספרס",
    s2: "רגיל",
  };
  // Decode tier/size codes to the human-readable label Eli sees on his
  // phone — sending raw `q1` / `p3` is ambiguous and forces a mental lookup.
  // For custom values, the customer's literal text is already stored on
  // quantityCustom / productCustom by the questionnaire's free-text branch.
  const qty =
    state.quantity === "custom"
      ? state.quantityCustom || "אחר"
      : QTY_LABEL[state.quantity ?? ""] ?? state.quantity ?? "?";
  const prod =
    state.product === "custom"
      ? state.productCustom || "מידה מיוחדת"
      : PROD_LABEL[state.product ?? ""] ?? state.product ?? "?";
  const handles = state.handles === "true" ? "עם ידיות" : "ללא ידיות";
  const lines = [
    `🏭 בקשת ציטוט מהמפעל — ${who}`,
    `כמות: ${qty}`,
    `מידה: ${prod}`,
    `משלוח: ${shipMap[state.shipping ?? ""] ?? state.shipping ?? "?"}`,
    `ידיות: ${handles}`,
    `צבעים: ${state.colors ?? "?"}`,
  ];
  if (state.lamination) {
    lines.push(`למינציה: ${state.lamination === "true" ? "כן" : "לא"}`);
  }
  if (state.orderNotes) {
    lines.push(`📝 הערות לקוח: ${state.orderNotes}`);
  }
  return lines.join("\n");
}

async function routeToFactory(
  ctx: LeadCtx,
  state: QState
): Promise<void> {
  const done: QState = {
    ...state,
    step: 10, // 9 = confirmation gate; 10 = terminal done state
    confirmationStep: null,
    doneAt: new Date().toISOString(),
    routedToFactory: true,
  };
  await db
    .update(leads)
    .set({
      qState: { ...(done as any), subFlow: "awaiting_factory_estimate" },
      pipelineStage: "FACTORY_WAIT",
      pipelineFlag: "NEEDS_ELI",
      botSummary: "questionnaire complete, custom spec → factory quote needed",
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
  await sendBridgeMessage(ctx.jid, FACTORY_HOLD_MSG);
  await sendEliDM(summarizeForFactory(state, ctx.name, ctx.phone));
}

async function routeToQuoted(
  ctx: LeadCtx,
  state: QState
): Promise<void> {
  try {
    const quote = await fetchQuote(state);
    const overCbm = isOverCbmConsolidationThreshold(quote.cbm);
    const done: QState = {
      ...state,
      step: 10, // 9 = confirmation gate; 10 = terminal done state
      confirmationStep: null,
      quoteResult: quote.text,
      doneAt: new Date().toISOString(),
    };
    await db
      .update(leads)
      .set({
        qState: { ...(done as any), subFlow: "awaiting_estimate_decision" },
        pipelineStage: "INTAKE",
        botSummary: overCbm
          ? `questionnaire complete, quote sent, awaiting decision · 🚢 >7 CBM (${quote.cbm.toFixed(2)}) — שילוח מוזל אפשרי`
          : "questionnaire complete, quote sent, awaiting decision",
        followUpCount: 0,
        lastFollowUpAt: new Date(),
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
    await logBotQuote({
      leadSid: ctx.sid,
      source: "initial",
      state: done,
      text: quote.text,
      totalIls: quote.totalIls,
      altTotalIls: quote.altTotalIls,
    });
    await sendBridgeMessage(ctx.jid, quote.text);
    await sendCompanyTemplate(ctx.jid);
    await sendBridgeMessage(ctx.jid, DECISION_PROMPT);
    if (overCbm) {
      // INTERNAL alert — push to Eli so he can revise the offer on cheap freight.
      await sendEliDM(
        `🚢 הצעה אוטומטית ל-${ctx.name ?? ctx.phone ?? "ליד"}: ${cbmConsolidationAlert(quote.cbm)}`
      );
    }
  } catch (e) {
    const bailed: QState = { ...state, bailed: true };
    await saveState(ctx.sid, bailed);
    await db
      .update(leads)
      .set({
        qState: { ...(bailed as any), subFlow: "awaiting_factory_estimate" },
        pipelineStage: "FACTORY_WAIT",
        pipelineFlag: "NEEDS_ELI",
        botSummary: `calc API failed: ${(e as Error).message}`,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
    await sendBridgeMessage(ctx.jid, FACTORY_HOLD_MSG);
    await sendEliDM(
      `⚠️ calc API נכשל ל-${ctx.name ?? ctx.phone ?? "ליד"} (${(e as Error).message}). השאלון הסתיים — צריך מחיר ידני.`
    );
  }
}

/**
 * Re-quote a lead after a mid-conversation spec change (e.g. customer
 * answered the price prompt with "תעשו 2500 יחידות"). Used by
 * decision.ts `awaiting_spec_change` once the LLM has merged the new
 * fields into qState. Pre-condition: `shouldRouteToFactory(state) === false`.
 *
 * Sends the new quote text + DECISION_PROMPT — the customer is back in
 * the "decide on this quote" gate, just with updated numbers. Returns
 * `false` if the calculator failed; caller should escalate.
 */
export async function requoteWithUpdatedSpec(input: {
  sid: string;
  jid: string;
  state: QState;
}): Promise<boolean> {
  try {
    const quote = await fetchQuote(input.state);
    const next: QState = {
      ...input.state,
      step: 10,
      confirmationStep: null,
      quoteResult: quote.text,
      doneAt: input.state.doneAt ?? new Date().toISOString(),
      specChangeAttempts: 0,
    };
    await db
      .update(leads)
      .set({
        qState: { ...(next as any), subFlow: "awaiting_estimate_decision" },
        pipelineStage: "INTAKE",
        botSummary: "spec change auto-requoted via LLM",
        followUpCount: 0,
        lastFollowUpAt: new Date(),
        nextAction: null,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${input.sid.trim()}`);
    await logBotQuote({
      leadSid: input.sid,
      source: "requote",
      state: next,
      text: quote.text,
      totalIls: quote.totalIls,
      altTotalIls: quote.altTotalIls,
    });
    await sendBridgeMessage(input.jid, quote.text);
    await sendCompanyTemplate(input.jid);
    await sendBridgeMessage(input.jid, DECISION_PROMPT);
    return true;
  } catch (e) {
    console.error(
      "[questionnaire] requoteWithUpdatedSpec failed",
      e instanceof Error ? e.message : e
    );
    return false;
  }
}

/**
 * Drive the questionnaire for a given lead + inbound text.
 */
export async function handleInbound(input: {
  sid: string;
  text: string | null;
}): Promise<{
  action:
    | "no_op"
    | "started"
    | "answered"
    | "custom_prompt"
    | "custom_captured"
    | "size_page_2"
    | "reasked"
    | "bailed"
    | "completed_standard"
    | "completed_factory"
    | "confirmation_sent"
    | "confirmation_freetext_prompt"
    | "confirmation_revised"
    | "confirmation_nothing_extracted";
  detail?: string;
}> {
  const ctx = await loadLeadCtx(input.sid);
  if (!ctx) return { action: "no_op", detail: "no lead row" };

  const stage = (ctx.pipelineStage ?? "").toUpperCase();
  // Any classified stage means the lead is past the questionnaire — skip.
  // Pre-quote leads have pipeline_stage = NULL. EXCEPTION: a fresh restart
  // (qState exists with step < 9 and no doneAt/bailed) takes precedence over
  // pipeline_stage — otherwise a stale GHL opp stage resynced back into DB
  // would block the re-quote questionnaire entirely.
  // Step 9 is the confirmation gate (handleConfirmationStep) — still
  // questionnaire-owned. Step 10 is the terminal done state.
  const qActive =
    !!ctx.qState &&
    typeof (ctx.qState as { step?: number }).step === "number" &&
    (ctx.qState as { step?: number }).step! <= 9 &&
    !(ctx.qState as { doneAt?: unknown }).doneAt &&
    !(ctx.qState as { bailed?: unknown }).bailed;
  if (stage && !qActive) {
    return { action: "no_op", detail: `pipeline_stage=${stage}` };
  }

  const text = (input.text ?? "").trim();
  const recipient = ctx.jid;

  if (ctx.qState?.bailed) {
    return { action: "no_op", detail: "bailed" };
  }
  if (ctx.qState?.doneAt) {
    return { action: "no_op", detail: "questionnaire already done" };
  }

  // Cold start.
  if (!ctx.qState) {
    const first = QUESTIONS[0];
    const newState: QState = { step: first.step };
    await saveState(ctx.sid, newState);
    await sendBridgeMessage(recipient, OPENING);
    await askQuestion(recipient, first);
    return { action: "started" };
  }

  // Step 9 — confirmation gate (post-questionnaire, pre-route).
  // The customer either confirms the summary or asks to change something.
  // Free-text revisions are parsed by spec-extractor and merged into qState.
  if (ctx.qState.step === 9) {
    return handleConfirmationStep(ctx, text);
  }

  // Free-text custom answer (e.g. dimensions or custom quantity).
  if (ctx.qState.pendingCustomField) {
    if (!text) {
      return { action: "no_op", detail: "empty custom answer" };
    }
    const field = ctx.qState.pendingCustomField;
    const captured: QState = {
      ...ctx.qState,
      pendingCustomField: null,
      unmatchedAt: 0,
    };
    if (field === "quantity") captured.quantityCustom = text;
    if (field === "product") captured.productCustom = text;
    const currentQ = getCurrentQuestion(ctx.qState!);
    const nextQ = currentQ ? findNextQuestion(currentQ.step) : undefined;
    if (nextQ) {
      captured.step = nextQ.step;
      await Promise.all([
        saveState(ctx.sid, captured),
        askQuestion(recipient, nextQ),
      ]);
      return { action: "custom_captured", detail: `${field}=${text}` };
    }
    // Custom on the LAST question — shouldn't happen since only Q4/Q5 are
    // custom-enabled, but handle defensively.
    captured.step = (currentQ?.step ?? 8) + 1;
    await saveState(ctx.sid, captured);
    await routeToFactory(ctx, captured);
    return { action: "completed_factory", detail: "custom on last question" };
  }

  const currentQ = getCurrentQuestion(ctx.qState!);
  if (!currentQ) {
    const next: QState = { ...ctx.qState, bailed: true };
    await saveState(ctx.sid, next);
    return { action: "bailed", detail: `unexpected step ${ctx.qState.step}` };
  }

  let match = matchAnswer(text, currentQ);

  // LLM fallback — when the dumb substring matcher returns null, ask
  // spec-extractor to map the customer's Hebrew to a canonical option.
  // This catches: "דחוף" → s1, "לא חייב" → false, "אלפיים" → custom+"2000".
  // Full conversation context is passed so the LLM understands what was
  // already answered and what the bot is currently asking.
  // Soft-fails on any LLM error — the original reask path runs unchanged.
  let llmCustomQuantity: string | undefined;
  let llmCustomProduct: string | undefined;
  if (!match) {
    try {
      const llmCtx = await buildLLMContext(ctx.sid);
      const context = llmCtx ? renderContextForPrompt(llmCtx) : undefined;
      const llm = await extractSingleField(text, currentQ.field as any, 0.7, context);
      if (llm) {
        match = llm.value;
        if (llm.quantityCustom) llmCustomQuantity = llm.quantityCustom;
        if (llm.productCustom) llmCustomProduct = llm.productCustom;
      }
    } catch (e) {
      console.error("[questionnaire] spec-extractor fallback error", e);
    }
  }

  if (!match) {
    const unmatched = (ctx.qState.unmatchedAt ?? 0) + 1;
    if (unmatched >= 3) {
      // Per CUSTOMER-FLOW.md v2 §1.1/1.2: reask × 3 → escalate.
      const bailed: QState = { ...ctx.qState, bailed: true, unmatchedAt: unmatched };
      await saveState(ctx.sid, bailed);
      await db
        .update(leads)
        .set({
          pipelineFlag: "NEEDS_ELI",
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
      await sendBridgeMessage(recipient, BAIL_REPLY);
      await sendEliDM(
        `⚠️ ${ctx.name ?? ctx.phone ?? "ליד"} — לא הצליח בשאלון האוטומטי (שלב ${currentQ.field}).\n📞 שיחה ידנית — אולי לקוח רציני שזקוק לעזרה.`
      );
      return { action: "bailed", detail: "three unmatched answers" };
    }
    const reasked: QState = { ...ctx.qState, unmatchedAt: unmatched };
    await saveState(ctx.sid, reasked);
    const reaskIdx = Math.min(unmatched - 1, REASK_REPLIES.length - 1);
    const reaskText =
      currentQ.field === "shipping" && unmatched >= 2
        ? "אני שואל קודם כל על שיטת המשלוח (זמן האספקה). תבחרו: אקספרס (~25 יום) או רגיל (~90 יום). על המידות ושאר הפרטים נגיע אחר כך."
        : REASK_REPLIES[reaskIdx];
    await sendBridgeMessage(recipient, reaskText);
    await askQuestion(recipient, currentQ);
    return { action: "reasked" };
  }

  // Step-5 page pivot — "צריך מידה אחרת" swaps the option set to page 2.
  // Stay on step 5; don't advance. matchAnswer can now hit p7..p13 / custom
  // because getCurrentQuestion will return PRODUCT_QUESTION_PAGE_2 next turn.
  if (currentQ.field === "product" && match === "more") {
    const paged: QState = {
      ...ctx.qState,
      sizePage: 2,
      unmatchedAt: 0,
    };
    await Promise.all([
      saveState(ctx.sid, paged),
      askQuestion(recipient, PRODUCT_QUESTION_PAGE_2),
    ]);
    return { action: "size_page_2", detail: "more sizes requested" };
  }

  // Custom branch on Q2/Q3 — capture free-text next inbound.
  // Special case: if the LLM fallback already extracted the custom value
  // (e.g. customer typed "7500 יחידות" → match=custom, llmCustomQuantity="7500"),
  // skip the pending-prompt round-trip and write it directly.
  if (currentQ.hasCustom && match === "custom") {
    const inlineCustom =
      currentQ.field === "quantity"
        ? llmCustomQuantity
        : currentQ.field === "product"
        ? llmCustomProduct
        : undefined;
    if (inlineCustom) {
      // Fall through to standard advance below with the custom value baked in.
      // We'll record it via the [field]Custom write a few lines down.
    } else {
      const pending: QState = {
        ...ctx.qState,
        [currentQ.field]: "custom",
        pendingCustomField: currentQ.field as "quantity" | "product",
        unmatchedAt: 0,
      };
      await saveState(ctx.sid, pending);
      await sendBridgeMessage(
        recipient,
        currentQ.customPrompt ?? "כתוב במילים מה אתה צריך:"
      );
      return { action: "custom_prompt", detail: currentQ.field };
    }
  }

  // Standard advance.
  const advanced: QState = {
    ...ctx.qState,
    [currentQ.field]: match,
    unmatchedAt: 0,
  };
  if (currentQ.field === "quantity" && llmCustomQuantity) {
    advanced.quantityCustom = llmCustomQuantity;
  }
  if (currentQ.field === "product" && llmCustomProduct) {
    advanced.productCustom = llmCustomProduct;
  }
  const nextQ = findNextQuestion(currentQ.step);
  if (nextQ) {
    advanced.step = nextQ.step;
    // saveState and askQuestion are independent — kicking the DB update in
    // parallel with the bridge send shaves ~10–50ms off the customer-facing
    // latency. Both still complete before this function returns.
    await Promise.all([
      saveState(ctx.sid, advanced),
      askQuestion(recipient, nextQ),
    ]);
    return { action: "answered", detail: `${currentQ.field}=${match}` };
  }

  // Last question answered → enter step 9 confirmation gate.
  // The actual route (factory vs quoted) is deferred until the customer
  // confirms or after `confirmationAttempts >= 2`.
  const finalized: QState = applyRetiredFieldDefaults({
    ...advanced,
    step: 9,
    confirmationStep: "awaiting_confirm",
    confirmationAttempts: 0,
  });
  await Promise.all([
    saveState(ctx.sid, finalized),
    askConfirmation(ctx, finalized),
  ]);
  return { action: "confirmation_sent" };
}

// --- Step 9 — confirmation gate ---

async function askConfirmation(ctx: LeadCtx, state: QState): Promise<void> {
  const body = buildConfirmationMessage(state);
  if (POLLS_ENABLED) {
    // Summary first (poll question maxLen ~255 — summary exceeds), then the
    // proceed/change poll. Two outbound messages but a single UX step from
    // the customer's perspective — they see the summary above the poll in
    // the chat thread.
    await sendBridgeMessage(ctx.jid, body);
    const poll = buildPoll(CONFIRMATION_QUESTION);
    await sendBridgeMessage(
      ctx.jid,
      "הכל בסדר, או רוצים לשנות משהו?",
      undefined,
      "bot",
      undefined,
      undefined,
      poll ?? undefined
    );
    return;
  }
  const btns = buildButtons(CONFIRMATION_QUESTION);
  await sendBridgeMessage(
    ctx.jid,
    body,
    undefined,
    "bot",
    undefined,
    btns ?? undefined
  );
}

async function handleConfirmationStep(
  ctx: LeadCtx,
  text: string
): Promise<{
  action:
    | "no_op"
    | "confirmation_sent"
    | "confirmation_freetext_prompt"
    | "confirmation_revised"
    | "confirmation_nothing_extracted"
    | "completed_standard"
    | "completed_factory";
  detail?: string;
}> {
  const state = ctx.qState as QState; // step 9 guaranteed by caller

  // Sub-state: customer is in free-text revision mode.
  if (state.confirmationStep === "awaiting_freetext") {
    if (!text) {
      return { action: "no_op", detail: "empty freetext" };
    }

    // Hand the customer's free text to spec-extractor.
    let extracted: ExtractedSpec | null = null;
    try {
      extracted = await extractSpecFromText({ text });
    } catch (e) {
      console.error("[questionnaire] spec-extractor freetext error", e);
    }

    // Bump attempts whether we succeeded or not — protects against infinite
    // back-and-forth on hard-to-parse text.
    const attempts = (state.confirmationAttempts ?? 0) + 1;

    if (!extracted) {
      // LLM unavailable → fall through to factory route so a human handles it.
      const next: QState = { ...state, confirmationAttempts: attempts };
      await saveState(ctx.sid, next);
      await sendBridgeMessage(ctx.jid, CONFIRM_MAX_ATTEMPTS_MSG);
      await routeToFactory(ctx, next);
      return { action: "completed_factory", detail: "extractor unavailable" };
    }

    const { merged, changed } = mergeExtracted(state, extracted);
    merged.confirmationAttempts = attempts;

    if (!changed) {
      // Nothing parseable — re-prompt unless we've maxed attempts.
      if (attempts >= 2) {
        await saveState(ctx.sid, merged);
        await sendBridgeMessage(ctx.jid, CONFIRM_MAX_ATTEMPTS_MSG);
        await routeToFactory(ctx, merged);
        return {
          action: "completed_factory",
          detail: "max attempts, nothing extracted",
        };
      }
      merged.confirmationStep = "awaiting_freetext";
      await saveState(ctx.sid, merged);
      await sendBridgeMessage(ctx.jid, CONFIRM_NOTHING_EXTRACTED);
      return {
        action: "confirmation_nothing_extracted",
        detail: `attempt ${attempts}`,
      };
    }

    // Change captured → show updated summary, back to awaiting_confirm.
    // If we've hit the cap of 2 revisions, route to factory instead.
    if (attempts >= 2) {
      merged.confirmationStep = null;
      await saveState(ctx.sid, merged);
      await sendBridgeMessage(ctx.jid, CONFIRM_AFTER_CHANGE_NOTE);
      await routeToFactory(ctx, merged);
      return {
        action: "completed_factory",
        detail: "max revisions reached",
      };
    }

    merged.confirmationStep = "awaiting_confirm";
    await saveState(ctx.sid, merged);
    await sendBridgeMessage(ctx.jid, CONFIRM_AFTER_CHANGE_NOTE);
    await askConfirmation(ctx, merged);
    return { action: "confirmation_revised", detail: `attempt ${attempts}` };
  }

  // Default sub-state: awaiting_confirm (or unset on a fresh entry).
  //
  // Resolution order (cheapest → most expensive):
  //   1. matchAnswer — catches "1" / "2" / button labels.
  //   2. keyword regex (substring, NOT anchored) — common Hebrew phrasings.
  //   3. classifyConfirmation LLM — last resort for off-script replies.
  //
  // When BOTH proceed and change signals fire, change wins: an explicit
  // "no/change" word is a stronger negative signal than a generic affirm.
  const match = matchAnswer(text, CONFIRMATION_QUESTION);
  const lowered = text.trim().toLowerCase();

  const PROCEED_RX =
    /(?:^|[\s,!.?])(כן|אישור|אוקיי|ok|okay|מעולה|מתאים|טוב|בסדר|המשך|תשלח|סבבה|מעוניין|רוצה את ההצעה|הכל טוב|הכל בסדר|זהו|זה הכל|אפשר להמשיך|נמשיך)(?:[\s,!.?]|$)/i;
  const CHANGE_RX =
    /(?:^|[\s,!.?])(לא|שנות|לשנות|לעדכן|שינוי|לתקן|הערה|אחר|לא מתאים|לא נכון|לא רוצה|לבטל|במקום|לשים|לשנות את|להוסיף|להחליף|לא בדיוק|להחזיר)(?:[\s,!.?]|$)/i;

  let isProceed = match === "proceed" || PROCEED_RX.test(lowered);
  let isChange = match === "change" || CHANGE_RX.test(lowered);

  // Both fired → ambiguous-leaning-to-change. Let the customer correct
  // rather than commit to a quote they didn't fully approve.
  if (isProceed && isChange) {
    isProceed = false;
  }

  // Neither fired — try LLM. Cheap (~$0.0001) and only runs on miss.
  if (!isProceed && !isChange && lowered.length >= 2) {
    try {
      const verdict = await classifyConfirmation(text);
      if (verdict === "proceed") isProceed = true;
      else if (verdict === "change") isChange = true;
    } catch (e) {
      console.error("[questionnaire] classifyConfirmation error", e);
    }
  }

  if (isProceed) {
    // Custom quantity inside the tier range (≥1000) snaps automatically via
    // calculator.quantityOverride — no need to send Eli. Only true factory
    // cases (custom dimensions, sub-tier quantity) require manual pricing.
    if (shouldRouteToFactory(state)) {
      await routeToFactory(ctx, state);
      return { action: "completed_factory" };
    }
    await routeToQuoted(ctx, state);
    return { action: "completed_standard" };
  }

  if (isChange) {
    const next: QState = { ...state, confirmationStep: "awaiting_freetext" };
    await saveState(ctx.sid, next);
    await sendBridgeMessage(ctx.jid, CONFIRM_FREETEXT_PROMPT);
    return { action: "confirmation_freetext_prompt" };
  }

  // All three classifiers failed. Cap repeated ambiguity so the customer
  // doesn't see the same summary forever — after 2 strikes, hand to Eli.
  const ambiguous = (state.confirmationAmbiguous ?? 0) + 1;
  if (ambiguous >= 2) {
    const bailed: QState = { ...state, confirmationAmbiguous: ambiguous };
    await sendBridgeMessage(ctx.jid, CONFIRM_AMBIGUOUS_BAIL_MSG);
    await routeToFactory(ctx, bailed);
    await sendEliDM(
      `⚠️ ${ctx.name ?? ctx.phone ?? "ליד"} נתקע ב-confirmation gate — לא הצלחתי לסווג proceed/change אחרי 2 ניסיונות. עבר ל-FACTORY_WAIT.`
    );
    return { action: "completed_factory", detail: "confirmation ambiguity cap" };
  }
  const next: QState = { ...state, confirmationAmbiguous: ambiguous };
  await saveState(ctx.sid, next);
  await askConfirmation(ctx, next);
  return {
    action: "confirmation_sent",
    detail: `ambiguous attempt ${ambiguous}`,
  };
}

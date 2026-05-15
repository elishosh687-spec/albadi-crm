/**
 * WhatsApp bag-quote questionnaire — direct port of the ManyChat Flow
 * documented at bag-quote-app/docs/manychat-flow.html, extended with:
 *   - "אחר" (custom) options on quantity (Q2) and product (Q3)
 *   - Custom-spec branch routes to WAITING_FACTORY + NEEDS_ELI + Eli DM at end
 *   - Standard path triggers AWAITING_DECISION sub-flow (handled in decision.ts)
 *
 * State machine:
 *   step 3: asked shipping
 *   step 4: asked quantity (option 5 = "אחר" → free-text capture in same step)
 *   step 5: asked product  (option 7 = "אחר" → free-text capture in same step)
 *   step 6: asked handles
 *   step 7: asked colors
 *   step 8: calling calc API (standard path) OR routing to factory (custom path)
 *   step 9: done
 *
 * Custom branches set q_state.pendingCustomField — on the next inbound the
 * text is stored in q_state.{field}Custom and the flow advances normally.
 */
import { db } from "../db";
import { leads } from "../../drizzle/schema";
import { sql } from "drizzle-orm";
import { sendBridgeMessage } from "../bridge/client";
import { sendEliDM } from "../notify/eli";
import { calculateQuoteByCodes } from "../factory/calculator";
import { buildQuoteMessage } from "../factory/calculator/message";
import {
  extractSpecFromText,
  extractSingleField,
  classifyConfirmation,
  type ExtractedSpec,
} from "./spec-extractor";

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

const OPENING =
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
      { value: "q0", label: "1,000 יחידות" },
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
    prompt: "📐 איזה גודל שקית?",
    options: [
      { value: "p1", label: "20×8×25 ס״מ — קוסמטיקה, תכשיטים" },
      { value: "p2", label: "30×10×30 ס״מ — ביגוד קל, מתנות" },
      { value: "p3", label: "40×12×30 ס״מ — נעליים, ביגוד" },
      { value: "p4", label: "40×15×50 ס״מ — פריטים גדולים" },
      { value: "p5", label: "30×40 ס״מ — פריטים רחבים" },
      { value: "p6", label: "20×15 ס״מ — פריטים קטנים" },
      { value: "custom", label: "אחר / מידה מותאמת" },
    ],
    hasCustom: true,
    customPrompt:
      "מה המידות שאתם צריכים? תכתבו אורך × רוחב × גובה ס״מ — לדוגמה 25×10×35.",
  },
  {
    step: 6,
    field: "handles",
    prompt: "🛍️ עם או בלי ידיות?",
    options: [
      { value: "true", label: "עם ידיות" },
      { value: "false", label: "ללא ידיות" },
    ],
    buttons: true,
  },
  {
    step: 7,
    field: "lamination",
    prompt: "✨ עם למינציה? (מראה יוקרתי, עמיד יותר, דוחה נוזלים)",
    options: [
      { value: "true", label: "עם למינציה" },
      { value: "false", label: "ללא למינציה" },
    ],
    buttons: true,
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


const DECISION_PROMPT =
  "מה דעתכם על ההצעה? אם מתאימה — נמשיך ללוגו. אם לא — תגידו לי מה לשנות.";
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
  prompt: "", // built dynamically per-lead via buildConfirmationMessage
  options: [
    { value: "proceed", label: CONFIRM_OPTION_PROCEED },
    { value: "change", label: CONFIRM_OPTION_CHANGE },
  ],
  buttons: true,
};

interface QState {
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
  orderNotes?: string;
}

function formatQuestion(q: Question): string {
  // When buttons are enabled AND the question is button-eligible, send only
  // the prompt — the bridge appends the option chips. With BUTTONS_DISABLED
  // we always render the full numbered list so the customer can reply with
  // a number or substring.
  if (!BUTTONS_DISABLED && q.buttons) {
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

// Global kill-switch for outbound interactive buttons. The bridge's `type=buttons`
// path produces messages whose taps do not round-trip on iOS (taps generate no
// `message.received` event, so the questionnaire never advances). Until the
// bridge implements a working tap webhook, every question goes out as plain
// numbered text. Flip back to `false` once Yehuda confirms taps deliver.
const BUTTONS_DISABLED = true;

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
  const btns = buildButtons(q);
  await sendBridgeMessage(
    recipient,
    formatQuestion(q),
    undefined,
    "bot",
    undefined,
    btns ?? undefined
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
const PROD_LABEL: Record<string, string> = {
  p1: "20×8×25 ס״מ",
  p2: "30×10×30 ס״מ",
  p3: "40×12×30 ס״מ",
  p4: "40×15×50 ס״מ",
  p5: "30×40 ס״מ",
  p6: "20×15 ס״מ",
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
  lines.push("", "הכל בסדר, או רוצים לשנות משהו?");
  // When buttons are disabled the customer doesn't see the proceed/change
  // chips — surface the same options as numbered text so they know what to
  // reply. matchAnswer accepts both "1"/"2" and the labels themselves.
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
function mergeExtracted(
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

async function fetchQuote(state: QState): Promise<string> {
  // Local calculator (ported from bag-quote-app). No HTTP roundtrip.
  if (!state.product || !state.quantity || !state.shipping) {
    throw new Error(
      `calc missing required state: product=${state.product} quantity=${state.quantity} shipping=${state.shipping}`
    );
  }
  const hasLamination = state.lamination === "true";
  const calc = calculateQuoteByCodes({
    productId: state.product,
    quantityTierId: state.quantity,
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
  return buildQuoteMessage({
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
    appUrl: "https://bag-quote-app.vercel.app",
    alt: calc.altResult
      ? {
          shippingName: calc.altResult.shippingOption?.name ?? "",
          shippingDays: calc.altResult.shippingOption?.deliveryDays ?? "",
          pricePerUnit: calc.altResult.sellingPricePerUnitIls,
          totalOrder: calc.altResult.totalOrderPriceIls,
        }
      : null,
  });
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
  const qty = state.quantityCustom || state.quantity || "?";
  const prod = state.productCustom || state.product || "?";
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
      qState: done as any,
      pipelineStage: "WAITING_FACTORY",
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
    const quoteText = await fetchQuote(state);
    const done: QState = {
      ...state,
      step: 10, // 9 = confirmation gate; 10 = terminal done state
      confirmationStep: null,
      quoteResult: quoteText,
      doneAt: new Date().toISOString(),
    };
    await db
      .update(leads)
      .set({
        qState: done as any,
        pipelineStage: "AWAITING_DECISION",
        botSummary: "questionnaire complete, quote sent, awaiting decision",
        followUpCount: 0,
        lastFollowUpAt: new Date(),
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
    await sendBridgeMessage(ctx.jid, quoteText);
    await sendBridgeMessage(ctx.jid, DECISION_PROMPT);
  } catch (e) {
    const bailed: QState = { ...state, bailed: true };
    await saveState(ctx.sid, bailed);
    await db
      .update(leads)
      .set({
        pipelineStage: "WAITING_FACTORY",
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
  if (stage && stage !== "NEW") {
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
    const currentQ = QUESTIONS.find((q) => q.step === ctx.qState!.step);
    const nextQ = currentQ
      ? QUESTIONS.find((q) => q.step === currentQ.step + 1)
      : null;
    if (nextQ) {
      captured.step = nextQ.step;
      await saveState(ctx.sid, captured);
      await askQuestion(recipient, nextQ);
      return { action: "custom_captured", detail: `${field}=${text}` };
    }
    // Custom on the LAST question — shouldn't happen since only Q4/Q5 are
    // custom-enabled, but handle defensively.
    captured.step = (currentQ?.step ?? 8) + 1;
    await saveState(ctx.sid, captured);
    await routeToFactory(ctx, captured);
    return { action: "completed_factory", detail: "custom on last question" };
  }

  const currentQ = QUESTIONS.find((q) => q.step === ctx.qState!.step);
  if (!currentQ) {
    const next: QState = { ...ctx.qState, bailed: true };
    await saveState(ctx.sid, next);
    return { action: "bailed", detail: `unexpected step ${ctx.qState.step}` };
  }

  let match = matchAnswer(text, currentQ);

  // LLM fallback — when the dumb substring matcher returns null, ask
  // spec-extractor to map the customer's Hebrew to a canonical option.
  // This catches: "דחוף" → s1, "לא חייב" → false, "אלפיים" → custom+"2000".
  // Soft-fails on any LLM error — the original reask path runs unchanged.
  let llmCustomQuantity: string | undefined;
  let llmCustomProduct: string | undefined;
  if (!match) {
    try {
      const llm = await extractSingleField(text, currentQ.field as any, 0.7);
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
    await sendBridgeMessage(recipient, REASK_REPLIES[reaskIdx]);
    await askQuestion(recipient, currentQ);
    return { action: "reasked" };
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
  const nextQ = QUESTIONS.find((q) => q.step === currentQ.step + 1);
  if (nextQ) {
    advanced.step = nextQ.step;
    await saveState(ctx.sid, advanced);
    await askQuestion(recipient, nextQ);
    return { action: "answered", detail: `${currentQ.field}=${match}` };
  }

  // Last question answered → enter step 9 confirmation gate.
  // The actual route (factory vs quoted) is deferred until the customer
  // confirms or after `confirmationAttempts >= 2`.
  advanced.step = 9;
  advanced.confirmationStep = "awaiting_confirm";
  advanced.confirmationAttempts = 0;
  await saveState(ctx.sid, advanced);
  await askConfirmation(ctx, advanced);
  return { action: "confirmation_sent" };
}

// --- Step 9 — confirmation gate ---

async function askConfirmation(ctx: LeadCtx, state: QState): Promise<void> {
  const body = buildConfirmationMessage(state);
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
    const isCustom =
      state.quantity === "custom" || state.product === "custom";
    if (isCustom) {
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
      `⚠️ ${ctx.name ?? ctx.phone ?? "ליד"} נתקע ב-confirmation gate — לא הצלחתי לסווג proceed/change אחרי 2 ניסיונות. עבר ל-WAITING_FACTORY.`
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

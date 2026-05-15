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
}

function formatQuestion(q: Question): string {
  // When the question goes out as WhatsApp buttons, the options become
  // tappable chips below the body — no need for a numbered list or a
  // "reply with 1, 2..." footer (and the bridge caps button title length
  // independently). Keep the prompt clean.
  if (q.buttons) {
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

function buildButtons(q: Question): { id: string; title: string }[] | null {
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
  return [
    `🏭 בקשת ציטוט מהמפעל — ${who}`,
    `כמות: ${qty}`,
    `מידה: ${prod}`,
    `משלוח: ${shipMap[state.shipping ?? ""] ?? state.shipping ?? "?"}`,
    `ידיות: ${handles}`,
    `צבעים: ${state.colors ?? "?"}`,
  ].join("\n");
}

async function routeToFactory(
  ctx: LeadCtx,
  state: QState
): Promise<void> {
  const done: QState = {
    ...state,
    step: 9,
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
      step: 9,
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
  action: "no_op" | "started" | "answered" | "custom_prompt" | "custom_captured" | "reasked" | "bailed" | "completed_standard" | "completed_factory";
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

  const match = matchAnswer(text, currentQ);
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
  if (currentQ.hasCustom && match === "custom") {
    const pending: QState = {
      ...ctx.qState,
      [currentQ.field]: "custom",
      pendingCustomField: currentQ.field as "quantity" | "product",
      unmatchedAt: 0,
    };
    await saveState(ctx.sid, pending);
    await sendBridgeMessage(recipient, currentQ.customPrompt ?? "כתוב במילים מה אתה צריך:");
    return { action: "custom_prompt", detail: currentQ.field };
  }

  // Standard advance.
  const advanced: QState = {
    ...ctx.qState,
    [currentQ.field]: match,
    unmatchedAt: 0,
  };
  const nextQ = QUESTIONS.find((q) => q.step === currentQ.step + 1);
  if (nextQ) {
    advanced.step = nextQ.step;
    await saveState(ctx.sid, advanced);
    await askQuestion(recipient, nextQ);
    return { action: "answered", detail: `${currentQ.field}=${match}` };
  }

  // Last question answered → route based on whether any field is custom.
  advanced.step = currentQ.step + 1; // step 9 (was 8 before lamination)
  await saveState(ctx.sid, advanced);
  const isCustom =
    advanced.quantity === "custom" || advanced.product === "custom";
  if (isCustom) {
    await routeToFactory(ctx, advanced);
    return { action: "completed_factory" };
  }
  await routeToQuoted(ctx, advanced);
  return { action: "completed_standard" };
}

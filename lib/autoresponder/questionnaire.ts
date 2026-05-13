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

type ListOption = { value: string; label: string };

interface Question {
  step: number;
  field: "shipping" | "quantity" | "product" | "handles" | "colors";
  prompt: string;
  options: ListOption[];
  /** When true, picking the last option triggers a free-text capture in the same step. */
  hasCustom?: boolean;
  /** Prompt the bot sends when waiting on the free-text custom value. */
  customPrompt?: string;
}

const OPENING =
  "שלום! 👋 אני אעזור לך לקבל הצעת מחיר מיידית לשקיות ממותגות. זה ייקח כ-2 דקות 😊";

const QUESTIONS: Question[] = [
  {
    step: 3,
    field: "shipping",
    prompt: "🚚 באיזו שיטת משלוח אתה מעוניין?",
    options: [
      { value: "s1", label: "✈️ אקספרס (~25 יום)" },
      { value: "s2", label: "🚢 רגיל (~90 יום)" },
    ],
  },
  {
    step: 4,
    field: "quantity",
    prompt: "📦 כמה יחידות אתה צריך?",
    options: [
      { value: "q0", label: "1,000 יחידות" },
      { value: "q1", label: "3,000 יחידות" },
      { value: "q2", label: "5,000 יחידות" },
      { value: "q3", label: "10,000 יחידות" },
      { value: "custom", label: "אחר / כמות מותאמת" },
    ],
    hasCustom: true,
    customPrompt: "כמה יחידות בדיוק אתה צריך? כתוב מספר (לדוגמה: 7500)",
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
    customPrompt: "מה המידות שאתה צריך? כתוב באורך × רוחב × גובה ס״מ (לדוגמה: 25×10×35)",
  },
  {
    step: 6,
    field: "handles",
    prompt: "🛍️ עם או בלי ידיות?",
    options: [
      { value: "true", label: "עם ידיות" },
      { value: "false", label: "ללא ידיות" },
    ],
  },
  {
    step: 7,
    field: "colors",
    prompt: "🎨 כמה צבעים בלוגו?",
    options: [
      { value: "1", label: "צבע אחד" },
      { value: "2", label: "2 צבעים" },
      { value: "3", label: "3 צבעים" },
    ],
  },
];

const CALC_URL = "https://bag-quote-app.vercel.app/api/quote/calculate";

const DECISION_PROMPT =
  "האם המחיר מתאים לך? 🤔 תכתוב לי תשובה ונמשיך הלאה.";
const FACTORY_HOLD_MSG =
  "תודה! 🙏 קיבלנו את המפרט. אנחנו מבררים מחיר מותאם מול המפעל ונחזור אליך תוך 24-48 שעות.";

interface QState {
  step: number;
  shipping?: string;
  quantity?: string;
  product?: string;
  handles?: string;
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
  const lines = [q.prompt, ""];
  q.options.forEach((opt, i) => {
    lines.push(`${i + 1}. ${opt.label}`);
  });
  lines.push("");
  lines.push("השב במספר (1, 2, ...) או בטקסט.");
  return lines.join("\n");
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
  const body = {
    shippingOptionId: state.shipping,
    quantityTierId: state.quantity,
    productId: state.product,
    hasHandles: state.handles === "true",
    logoColors: Number(state.colors),
    selectedFeatureIds: [] as string[],
  };
  const res = await fetch(CALC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`calc ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    text?: string;
    content?: { messages?: { text?: string }[] };
  };
  const text = json.text ?? json.content?.messages?.[0]?.text;
  if (!text) {
    throw new Error(`calc returned no message text: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return text;
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
  return {
    sid: row.sid,
    jid: row.jid ?? sid,
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
    await sendBridgeMessage(recipient, formatQuestion(first));
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
      await sendBridgeMessage(recipient, formatQuestion(nextQ));
      return { action: "custom_captured", detail: `${field}=${text}` };
    }
    // Custom on the LAST question — shouldn't happen since only Q2/Q3 are
    // custom-enabled, but handle defensively.
    captured.step = (currentQ?.step ?? 7) + 1;
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
    if (unmatched >= 2) {
      // Don't drop — escalate so Eli can recover the lead.
      const bailed: QState = { ...ctx.qState, bailed: true, unmatchedAt: unmatched };
      await saveState(ctx.sid, bailed);
      await db
        .update(leads)
        .set({
          pipelineFlag: "NEEDS_ELI",
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
      await sendBridgeMessage(
        recipient,
        "תודה, נחזור אליך עם הצעה מותאמת ⏳"
      );
      await sendEliDM(
        `⚠️ ${ctx.name ?? ctx.phone ?? "ליד"} נכשל בשאלון (2 תשובות לא תואמות בשלב ${currentQ.field}). צריך טיפול ידני.`
      );
      return { action: "bailed", detail: "two unmatched answers" };
    }
    const reasked: QState = { ...ctx.qState, unmatchedAt: unmatched };
    await saveState(ctx.sid, reasked);
    await sendBridgeMessage(
      recipient,
      "🤔 לא הצלחתי להבין. אפשר לבחור מספר מהרשימה?"
    );
    await sendBridgeMessage(recipient, formatQuestion(currentQ));
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
    await sendBridgeMessage(recipient, formatQuestion(nextQ));
    return { action: "answered", detail: `${currentQ.field}=${match}` };
  }

  // Last question answered → route based on whether any field is custom.
  advanced.step = currentQ.step + 1; // step 8
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

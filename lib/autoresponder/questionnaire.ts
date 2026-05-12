/**
 * WhatsApp bag-quote questionnaire — direct port of the ManyChat Flow
 * documented at bag-quote-app/docs/manychat-flow.html.
 *
 * State machine:
 *   step 1: idle (waiting for first inbound) — actually no row, we kick off on first inbound.
 *   step 2: opening message sent → next user message answers shipping.
 *   step 3: answered shipping, asked quantity.
 *   step 4: answered quantity, asked product.
 *   step 5: answered product, asked handles.
 *   step 6: answered handles, asked colors.
 *   step 7: answered colors, calling calc API.
 *   step 8: sent quote → done.
 *
 * We only run the questionnaire for leads with pipeline_stage IN
 * (NULL, 'NEW') so Eli's in-progress conversations are NOT hijacked.
 *
 * On free-text answers we try a best-effort match (numeric position →
 * list value, or list-value literal). One unmatched answer = re-ask.
 * A second unmatched = bail (set q_state.bailed = true so Eli sees it).
 */
import { db } from "../db";
import { leads } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { sendBridgeMessage } from "../bridge/client";

type ListOption = { value: string; label: string };

interface Question {
  step: number;
  field: "shipping" | "quantity" | "product" | "handles" | "colors";
  prompt: string;
  options: ListOption[];
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
    ],
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
    ],
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

interface QState {
  step: number;
  shipping?: string;
  quantity?: string;
  product?: string;
  handles?: string;
  colors?: string;
  quoteResult?: string;
  bailed?: boolean;
  unmatchedAt?: number;
  doneAt?: string;
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
  // Numeric position 1..N
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
    return q.options[n - 1].value;
  }
  // Exact value
  for (const opt of q.options) {
    if (opt.value.toLowerCase() === t) return opt.value;
  }
  // Substring of label (handles, "עם", "ללא", etc.)
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
  // Calc API returns flat { text } today; the documented ManyChat Flow
  // uses path content.messages[0].text — accept both in case ManyChat
  // adapter is added later.
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
  pipelineStage: string | null;
  qState: QState | null;
}

export async function loadLeadCtx(sid: string): Promise<LeadCtx | null> {
  const [row] = await db
    .select({
      sid: leads.manychatSubId,
      jid: leads.waJid,
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
    pipelineStage: row.pipelineStage,
    qState: (row.qState as QState | null) ?? null,
  };
}

/**
 * Drive the auto-responder for a given lead + inbound text.
 * Returns the action taken (for logging).
 */
export async function handleInbound(input: {
  sid: string;
  text: string | null;
}): Promise<{
  action: "no_op" | "started" | "answered" | "reasked" | "bailed" | "completed";
  detail?: string;
}> {
  const ctx = await loadLeadCtx(input.sid);
  if (!ctx) return { action: "no_op", detail: "no lead row" };

  // Only auto-respond to brand-new or unstarted leads.
  const stage = (ctx.pipelineStage ?? "").toUpperCase();
  if (stage && stage !== "NEW") {
    return { action: "no_op", detail: `pipeline_stage=${stage}` };
  }

  const text = (input.text ?? "").trim();
  const recipient = ctx.jid;

  // Bailed already — Eli takes over.
  if (ctx.qState?.bailed) {
    return { action: "no_op", detail: "bailed" };
  }
  // Already done — Eli takes over (lead probably re-engaging).
  if (ctx.qState?.doneAt) {
    return { action: "no_op", detail: "questionnaire already done" };
  }

  // Cold start: no q_state yet → send opening + first question.
  if (!ctx.qState) {
    if (!text) {
      // Empty/media-only inbound — still kick off.
    }
    const first = QUESTIONS[0];
    const newState: QState = { step: first.step };
    await saveState(ctx.sid, newState);
    await sendBridgeMessage(recipient, OPENING);
    await sendBridgeMessage(recipient, formatQuestion(first));
    return { action: "started" };
  }

  // Mid-flow: match incoming text against the current question.
  const currentQ = QUESTIONS.find((q) => q.step === ctx.qState!.step);
  if (!currentQ) {
    // qState is on a non-question step (8/9) but not done? Shouldn't happen — bail.
    const next: QState = { ...ctx.qState, bailed: true };
    await saveState(ctx.sid, next);
    return { action: "bailed", detail: `unexpected step ${ctx.qState.step}` };
  }

  const match = matchAnswer(text, currentQ);
  if (!match) {
    const unmatched = (ctx.qState.unmatchedAt ?? 0) + 1;
    if (unmatched >= 2) {
      const bailed: QState = { ...ctx.qState, bailed: true, unmatchedAt: unmatched };
      await saveState(ctx.sid, bailed);
      await sendBridgeMessage(
        recipient,
        "תודה, אנחנו נחזור אליך עם הצעה מותאמת ⏳"
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

  // Store answer, advance.
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

  // Last question answered → hit calc API.
  advanced.step = currentQ.step + 1; // step 8 (calculating)
  await saveState(ctx.sid, advanced);
  try {
    const quoteText = await fetchQuote(advanced);
    const done: QState = {
      ...advanced,
      step: currentQ.step + 2,
      quoteResult: quoteText,
      doneAt: new Date().toISOString(),
    };
    await db
      .update(leads)
      .set({
        qState: done as any,
        pipelineStage: "QUOTED",
        botSummary: "questionnaire auto-completed; quote sent",
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${input.sid.trim()}`);
    await sendBridgeMessage(recipient, quoteText);
    return { action: "completed" };
  } catch (e) {
    const bailed: QState = { ...advanced, bailed: true };
    await saveState(ctx.sid, bailed);
    await sendBridgeMessage(
      recipient,
      "תודה! אנחנו עובדים על הצעת המחיר ונחזור אליך בקרוב ⏳"
    );
    return { action: "bailed", detail: `calc failed: ${(e as Error).message}` };
  }
}

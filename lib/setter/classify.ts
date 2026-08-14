/**
 * Setter layer, stage 2 — the sales state classifier.
 *
 * One cheap LLM call that ANALYSES and never writes customer copy. Coarse
 * enums on purpose: a model that returns meeting_readiness 0.72 can't really
 * tell it apart from 0.68 — fake precision that's hard to route on. Four
 * buckets are honest and routable.
 */
import { callLLM } from "../autoresponder/openai-client";
import { getBotSettings } from "../bot-settings/store";
import type { SalesContext } from "./context";

export type ObjectionType =
  | "price_absolute"
  | "competitor"
  | "timing"
  | "needs_approval"
  | "trust_product"
  | "polite_rejection"
  | "unclear";

export interface SalesClassification {
  intent:
    | "interested"
    | "considering"
    | "objecting"
    | "asking_question"
    | "ready_to_proceed"
    | "postponing"
    | "gone_quiet"
    | "not_interested"
    | "unclear";
  objectionType: ObjectionType | null;
  buyingSignal: "none" | "weak" | "medium" | "strong";
  meetingReadiness: "not_ready" | "warming" | "ready" | "asked_for_call";
}

const FALLBACK: SalesClassification = {
  intent: "unclear",
  objectionType: null,
  buyingSignal: "none",
  meetingReadiness: "not_ready",
};

const ALLOWED = {
  intent: [
    "interested",
    "considering",
    "objecting",
    "asking_question",
    "ready_to_proceed",
    "postponing",
    "gone_quiet",
    "not_interested",
    "unclear",
  ],
  objectionType: [
    "price_absolute",
    "competitor",
    "timing",
    "needs_approval",
    "trust_product",
    "polite_rejection",
    "unclear",
  ],
  buyingSignal: ["none", "weak", "medium", "strong"],
  meetingReadiness: ["not_ready", "warming", "ready", "asked_for_call"],
} as const;

function pick<T extends string>(v: unknown, allowed: readonly string[], fallback: T): T {
  return typeof v === "string" && allowed.includes(v) ? (v as T) : fallback;
}

export async function classifySalesState(
  ctx: SalesContext
): Promise<SalesClassification> {
  // A lead with no inbound at all needs no LLM to be classified.
  if (!ctx.lastCustomerMessage) {
    return { ...FALLBACK, intent: "gone_quiet" };
  }

  // Long silence is a DB fact, not a judgment call: we spoke last and the
  // customer has been quiet for half a day+ — that's gone_quiet regardless of
  // what their final message said. Skips the LLM entirely on the exact runs
  // (follow-up sweeps) that happen in bulk.
  const goneQuietHours = (await getBotSettings()).setterGoneQuietHours;
  if (
    ctx.timing.turn === "customer" &&
    (ctx.timing.hoursSinceLastCustomerMessage ?? 0) >= goneQuietHours
  ) {
    return { ...FALLBACK, intent: "gone_quiet" };
  }

  const transcript = ctx.recentMessages
    .map((m) => `${m.from === "customer" ? "לקוח" : "אנחנו"}: ${m.text}`)
    .join("\n");

  const res = await callLLM<Record<string, unknown>>({
    jsonMode: true,
    timeoutMs: 8000,
    system:
      "אתה מנתח שיחת מכירה ב-WhatsApp (שקיות ממותגות B2B). אל תכתוב הודעה — רק נתח. " +
      "החזר JSON בדיוק במבנה: " +
      '{"intent": one of ' +
      JSON.stringify(ALLOWED.intent) +
      ', "objection_type": one of ' +
      JSON.stringify(ALLOWED.objectionType) +
      ' or null, "buying_signal": one of ' +
      JSON.stringify(ALLOWED.buyingSignal) +
      ', "meeting_readiness": one of ' +
      JSON.stringify(ALLOWED.meetingReadiness) +
      "}. " +
      'הנחיות: "יקר לי" בלי פירוט = objecting עם objection_type לפי ההקשר (unclear אם אין רמז). ' +
      'שאלות על פרטים (משלוח, צבעים) הן סימן קנייה weak-medium. ' +
      'asked_for_call רק אם הלקוח עצמו ביקש שיחה/טלפון במילים שלו — אף פעם לא בגלל שאנחנו הצענו שיחה או שלחנו קישור. ' +
      "אם ספק — בחר את הערך השמרני.",
    user:
      `שלב: ${ctx.stage ?? "שאלון"} | הצעה נשלחה: ${ctx.quote.sent ? `כן (₪${ctx.quote.totalIls ?? "?"})` : "לא"} | ` +
      `שקט מהלקוח: ${ctx.timing.hoursSinceLastCustomerMessage ?? "?"} שעות\n\nשיחה אחרונה:\n${transcript}`,
  });
  if (!res) return FALLBACK;

  const objection = res.objection_type;
  return {
    intent: pick(res.intent, ALLOWED.intent, "unclear"),
    objectionType:
      objection === null || objection === undefined
        ? null
        : pick(objection, ALLOWED.objectionType, "unclear"),
    buyingSignal: pick(res.buying_signal, ALLOWED.buyingSignal, "none"),
    meetingReadiness: pick(res.meeting_readiness, ALLOWED.meetingReadiness, "not_ready"),
  };
}

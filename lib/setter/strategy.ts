/**
 * Setter layer, stages 3+4 — skill router and strategy planner.
 *
 * DETERMINISTIC. The state decides which 1-3 skills load and what the tactical
 * frame is; no LLM here. This is the table you read to answer "why did the bot
 * do that?" — which is exactly why it must not be a model call.
 */
import type { SalesContext } from "./context";
import type { SalesClassification } from "./classify";
import type { SkillId } from "./skills";

export interface SalesStrategy {
  goal: "book_call" | "answer_and_advance" | "explore_objection" | "revive" | "hold_back";
  skills: SkillId[];
  /** Tactical do's, passed to the generator. */
  moves: string[];
  /** Tactical don'ts, passed to the generator AND enforced by the validator
   *  where they're mechanical. */
  avoid: string[];
  /** What to ask the customer to have ready (from missing_information). */
  informationToRequest: string[];
}

const PREP_HE: Record<string, string> = {
  size: "מידות",
  logo: "קובץ לוגו",
  quantity: "כמות",
  usage: "ייעוד השקית",
};

export function planStrategy(
  ctx: SalesContext,
  cls: SalesClassification
): SalesStrategy {
  const info = ctx.missingInformation.map((m) => PREP_HE[m] ?? m);
  const base = {
    informationToRequest: info,
    avoid: [
      "אל תמציא מחירים, הנחות או זמינות",
      "אל תשאל מידע שכבר ידוע",
      "מקסימום שאלה אחת",
    ],
  };

  // Explicit call request wins over everything.
  if (cls.meetingReadiness === "asked_for_call") {
    return {
      ...base,
      goal: "book_call",
      skills: ["appointment_booking", "callback_scheduling"],
      moves: ["אשר מיד", "הצע שני חלונות זמן קונקרטיים", "אמור מה להכין"],
    };
  }

  // Objection → explore before redirecting; price objections get the AER frame.
  if (cls.intent === "objecting") {
    return {
      ...base,
      goal: "explore_objection",
      skills:
        cls.objectionType === "price_absolute" || cls.objectionType === "competitor"
          ? ["objection_price_aer", "micro_commitment"]
          : ["objection_explore", "pause_intelligence"],
      moves: ["הכר בקצרה", "שאלה אחת שמבררת את מקור ההתנגדות"],
      avoid: [...base.avoid, "אל תצדיק את המחיר", "אל תציע הנחה"],
    };
  }

  // Postponing → pin the postponement to a concrete time.
  if (cls.intent === "postponing") {
    return {
      ...base,
      goal: "book_call",
      skills: ["callback_scheduling", "micro_commitment"],
      moves: ["קבל את הדחייה", "הפוך אותה לזמן מוגדר"],
    };
  }

  // Silence after a quote → one grounded revival message.
  if (cls.intent === "gone_quiet" && ctx.quote.sent) {
    return {
      ...base,
      goal: "revive",
      skills: ["ghost_recovery", "appointment_booking"],
      moves: [
        `עגן בהצעה הספציפית${ctx.quote.totalIls ? ` (₪${ctx.quote.totalIls.toLocaleString()})` : ""}`,
        "הצעת שיחה בזמן קונקרטי",
      ],
    };
  }

  // Strong interest → convert the moment into a call.
  if (
    cls.intent === "ready_to_proceed" ||
    (cls.buyingSignal === "strong" && cls.meetingReadiness !== "not_ready")
  ) {
    return {
      ...base,
      goal: "book_call",
      skills: ["buying_signal_amplification", "appointment_booking"],
      moves: ["אשר בקצרה", "חבר ישירות להצעת שיחה עם זמן"],
    };
  }

  // Question / lukewarm engagement → answer, advance one step, don't shove.
  if (cls.intent === "asking_question" || cls.intent === "interested" || cls.intent === "considering") {
    const warm = cls.meetingReadiness === "ready" || cls.buyingSignal === "medium";
    return {
      ...base,
      goal: "answer_and_advance",
      skills: warm
        ? ["flow_management", "buying_signal_amplification", "appointment_booking"]
        : ["flow_management", "micro_commitment"],
      moves: ["ענה ישירות על מה שנשאל", warm ? "סיים בהצעת שיחה" : "סיים בצעד קטן אחד"],
    };
  }

  // Not interested / unclear cold state → don't push.
  return {
    ...base,
    goal: "hold_back",
    skills: ["pause_intelligence", "follow_up_discipline"],
    moves: ["תגובה קצרה ומכבדת", "בלי דחיפה לשיחה בתור הזה"],
  };
}

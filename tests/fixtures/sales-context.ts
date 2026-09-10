/**
 * Builders for the setter layer's deterministic inputs.
 *
 * `SalesContext` is normally assembled from the DB by `buildSalesContext`;
 * unit tests hand-build one so the validator can be exercised without a
 * database. Defaults describe בתאל's situation on 2026-08-31 — a lead in
 * INTAKE holding the questionnaire's ₪2,610 auto-quote.
 */
import type { SalesContext } from "@/lib/setter/context";
import type { SalesStrategy } from "@/lib/setter/strategy";
import type { CallSlot } from "@/lib/setter/slots";

type ContextOverrides = Partial<Omit<SalesContext, "quote" | "timing" | "dossier">> & {
  quote?: Partial<SalesContext["quote"]>;
  timing?: Partial<SalesContext["timing"]>;
  dossier?: Partial<SalesContext["dossier"]>;
};

export function makeSalesContext(overrides: ContextOverrides = {}): SalesContext {
  const { quote, timing, dossier, ...rest } = overrides;
  return {
    sid: "972502348255@c.us",
    name: "בתאל",
    stage: "INTAKE",
    subFlow: null,
    quote: {
      sent: true,
      totalIls: 2610,
      sentAtIso: "2026-08-31T08:00:00.000Z",
      supersededAtIso: null,
      ...quote,
    },
    missingInformation: ["size_confirm", "logo"],
    timing: {
      hoursSinceLastCustomerMessage: 26,
      hoursSinceLastBotMessage: 24,
      turn: "customer",
      ...timing,
    },
    recentMessages: [
      { from: "us", text: "הצעת המחיר: 3,000 שקיות ב-₪2,610" },
      { from: "customer", text: "תודה, אני אחשוב על זה" },
    ],
    lastCustomerMessage: "תודה, אני אחשוב על זה",
    dossier: {
      notes: null,
      botSummary: null,
      verdict: null,
      lastCall: null,
      ...dossier,
    },
    ...rest,
  };
}

export function makeStrategy(
  goal: SalesStrategy["goal"],
  overrides: Partial<Omit<SalesStrategy, "goal">> = {}
): SalesStrategy {
  return {
    goal,
    skills: goal === "book_call" ? ["appointment_booking", "callback_scheduling"] : [],
    moves: [],
    avoid: ["אל תמציא מחירים, הנחות או זמינות", "מקסימום שאלה אחת"],
    informationToRequest: [],
    ...overrides,
  };
}

/** Two windows as `proposeCallSlots` would hand them out on a Tuesday evening. */
export const TOMORROW_11: CallSlot = {
  label: "מחר ב-11:00",
  time: "11:00",
  iso: "2026-09-02T08:00:00.000Z",
};

export const THURSDAY_12: CallSlot = {
  label: "ביום חמישי ב-12:00",
  time: "12:00",
  iso: "2026-09-03T09:00:00.000Z",
};

export const ALLOWED_SLOTS: CallSlot[] = [TOMORROW_11, THURSDAY_12];

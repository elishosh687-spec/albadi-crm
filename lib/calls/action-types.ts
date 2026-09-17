import type { CallActionType, ProposedCallAction } from "./analysis-v2";

export const CALL_ACTION_TYPES: readonly CallActionType[] = [
  "callback",
  "send_quote",
  "send_sample",
  "check_logo_received",
  "check_payment",
  "follow_up",
  "factory_check",
  "other",
];

const TITLES: Record<CallActionType, string> = {
  callback: "📞 לחזור ללקוח",
  send_quote: "📄 לשלוח הצעת מחיר",
  send_sample: "🛍️ לשלוח דוגמה",
  check_logo_received: "🎨 לוודא שהלוגו התקבל",
  check_payment: "💳 לבדוק תשלום",
  follow_up: "↩️ לבצע מעקב עם הלקוח",
  factory_check: "🏭 לבדוק מול המפעל",
  other: "📌 המשך טיפול בשיחה",
};

export function parseActionTypes(value: string): Set<CallActionType> {
  const valid = new Set<string>(CALL_ACTION_TYPES);
  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part): part is CallActionType => valid.has(part)),
  );
}

export function taskTitleForAction(action: ProposedCallAction): string {
  const prefix = TITLES[action.actionType];
  const description = action.description.trim();
  if (!description) return prefix;
  return `${prefix}: ${description}`.slice(0, 120);
}

/** Customer/factory promises become a task owned by the salesperson to verify. */
export function toSalespersonFollowUp(action: ProposedCallAction): ProposedCallAction {
  if (action.responsibleParty === "salesperson" || action.responsibleParty === "unknown") {
    return action;
  }
  const party = action.responsibleParty === "customer" ? "הלקוח" : "המפעל";
  const actionType: CallActionType =
    action.responsibleParty === "customer" && /לוגו/.test(action.description)
      ? "check_logo_received"
      : "follow_up";
  return {
    ...action,
    actionType,
    responsibleParty: "salesperson",
    description: `לוודא ש${party} ביצע: ${action.description}`,
  };
}

import { planStrategy } from "../lib/setter/strategy";
import { validateMessage } from "../lib/setter/generate";
import type { SalesContext } from "../lib/setter/context";
import type { SalesClassification } from "../lib/setter/classify";

const ctx: SalesContext = {
  sid: "test", name: "דני", stage: "INTAKE", subFlow: "awaiting_estimate_decision",
  quote: { sent: true, totalIls: 6050, sentAtIso: new Date().toISOString() },
  missingInformation: ["logo"],
  timing: { hoursSinceLastCustomerMessage: 3, hoursSinceLastBotMessage: 3, turn: "customer" },
  recentMessages: [], lastCustomerMessage: "יקר לי",
};

const cases: [string, Partial<SalesClassification>][] = [
  ["ביקש שיחה", { intent: "interested", meetingReadiness: "asked_for_call" }],
  ["יקר לי (מחיר)", { intent: "objecting", objectionType: "price_absolute" }],
  ["התנגדות לא ברורה", { intent: "objecting", objectionType: "unclear" }],
  ["דבר איתי שבוע הבא", { intent: "postponing" }],
  ["שתק אחרי הצעה", { intent: "gone_quiet" }],
  ["נשמע טוב!", { intent: "ready_to_proceed", buyingSignal: "strong", meetingReadiness: "ready" }],
  ["שאלה על משלוח (חם)", { intent: "asking_question", buyingSignal: "medium", meetingReadiness: "ready" }],
  ["שאלה על משלוח (קר)", { intent: "asking_question", buyingSignal: "weak", meetingReadiness: "not_ready" }],
  ["לא מעוניין", { intent: "not_interested" }],
];

const base: SalesClassification = { intent: "unclear", objectionType: null, buyingSignal: "none", meetingReadiness: "not_ready" };
for (const [label, patch] of cases) {
  const s = planStrategy(ctx, { ...base, ...patch });
  console.log(`${label.padEnd(24)} → ${s.goal.padEnd(18)} [${s.skills.join(", ")}]`);
}

console.log("\n=== validator ===");
const strat = planStrategy(ctx, { ...base, intent: "gone_quiet" });
const checks: [string, string][] = [
  ["תקין", "היי דני, ההצעה של ₪6,050 עדיין רלוונטית? אשמח לשיחה קצרה מחר ב-11:00 לסגור את הלוגו 🙂"],
  ["מחיר מומצא", "אפשר לסגור על ₪5,200 בלבד!"],
  ["הנחה", "אתן לך הנחה של 10% אם נסגור היום"],
  ["שתי שאלות", "מה דעתך? מתי נוח לך?"],
  ["ארוך מדי", Array(70).fill("מילה").join(" ")],
];
for (const [label, text] of checks) {
  const v = validateMessage(text, ctx, strat);
  console.log(`${label.padEnd(14)} → ${v.ok ? "✓ עבר" : "✗ " + v.violations.join("; ")}`);
}

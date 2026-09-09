/**
 * Pure check on hasAnyField — no LLM, no DB. This is the line that turned an
 * extraction FAILURE into a claimed success and quoted the old price.
 */
import { hasAnyField } from "@/lib/autoresponder/spec-extractor";

const cases: [string, any, boolean][] = [
  ["note only (what 'כמות' produced)", { notes: "הלקוח ציין רק כמות ללא מספר", confidence: 0.3 }, false],
  ["empty", { confidence: 0 }, false],
  ["real quantity", { quantity: "q2", confidence: 0.9 }, true],
  ["custom quantity", { quantity: "custom", quantityCustom: "5000", confidence: 0.9 }, true],
  ["handles only", { handles: "false", confidence: 0.8 }, true],
  ["field + note", { colors: "2", notes: "גם שאל על מחיר", confidence: 0.7 }, true],
];
let bad = 0;
for (const [label, spec, want] of cases) {
  const got = hasAnyField(spec);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label} → ${got ? "apply" : "ask"}`);
}
console.log(bad === 0 ? "\nALL PASS" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);

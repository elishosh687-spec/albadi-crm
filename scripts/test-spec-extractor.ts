/**
 * Smoke test for spec-extractor LLM.
 *
 * Runs a fixed bank of Hebrew customer phrasings through extractSpecFromText
 * and prints expected vs actual side-by-side. Catches regressions when the
 * model / prompt changes.
 *
 * Run:  OPENAI_API_KEY=... npx tsx scripts/test-spec-extractor.ts
 */
import "dotenv/config";
import {
  extractSpecFromText,
  type ExtractedSpec,
} from "../lib/autoresponder/spec-extractor";

interface Case {
  text: string;
  /** Subset of fields we expect the extractor to fill. */
  expect: Partial<ExtractedSpec>;
  /** Free description for the test output. */
  why: string;
}

const CASES: Case[] = [
  // shipping
  { text: "דחוף לי", expect: { shipping: "s1" }, why: "express synonym" },
  { text: "אין לחץ זמן", expect: { shipping: "s2" }, why: "no rush → regular" },
  { text: "תוך שבועיים אם אפשר", expect: { shipping: "s1" }, why: "≤25 days → express" },

  // quantity
  { text: "אלפיים יחידות", expect: { quantity: "custom", quantityCustom: "2000" }, why: "Hebrew number, non-tier" },
  { text: "3000 יחידות", expect: { quantity: "q1" }, why: "exact tier" },
  { text: "10 אלף", expect: { quantity: "q3" }, why: "10K tier with Hebrew unit" },

  // product / size
  { text: "מידה רגילה לביגוד", expect: { product: "p3" }, why: "ביגוד → p3 (40×12×30)" },
  { text: "25 על 10 על 35", expect: { product: "custom", productCustom: "25×10×35" }, why: "custom dims" },

  // handles
  { text: "כן, חשוב לי ידיות", expect: { handles: "true" }, why: "affirmative + 'ידיות'" },
  { text: "בלי, אין צורך", expect: { handles: "false" }, why: "negative 'בלי'" },
  { text: "לא חייב", expect: { handles: "false" }, why: "soft negative — current matchAnswer fails here" },

  // lamination
  { text: "עם למינציה", expect: { lamination: "true" }, why: "explicit" },
  { text: "פשוט, בלי", expect: { lamination: "false" }, why: "no lamination" },

  // colors
  { text: "שני צבעים", expect: { colors: "2" }, why: "Hebrew number" },
  { text: "שחור-לבן בלבד", expect: { colors: "1" }, why: "single-color synonym" },

  // notes only
  { text: "אני צריך את זה לתערוכה בחודש הבא", expect: {}, why: "notes-only, no field" },

  // ambiguous → should be low confidence
  { text: "אהההה", expect: {}, why: "junk → low confidence" },
];

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}
function ok(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}
function bad(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}

async function run() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const c of CASES) {
    const got = await extractSpecFromText({ text: c.text });
    if (!got) {
      console.log(bad(`✗  ${c.text}  →  LLM returned null  (${c.why})`));
      failed++;
      continue;
    }
    const mismatches: string[] = [];
    for (const [k, v] of Object.entries(c.expect)) {
      const actual = (got as any)[k];
      if (actual !== v) {
        mismatches.push(`${k}: expected=${JSON.stringify(v)} actual=${JSON.stringify(actual)}`);
      }
    }
    // If we expected nothing structured, just check confidence stayed low.
    if (Object.keys(c.expect).length === 0) {
      const anyField =
        got.shipping ||
        got.quantity ||
        got.product ||
        got.handles ||
        got.lamination ||
        got.colors;
      if (anyField && got.confidence >= 0.7) {
        mismatches.push(
          `expected no high-conf field; got ${JSON.stringify(anyField)} @ conf=${got.confidence}`
        );
      }
    }
    if (mismatches.length === 0) {
      console.log(
        ok(`✓  ${c.text}`) +
          dim(`   conf=${got.confidence.toFixed(2)} (${c.why})`)
      );
      passed++;
    } else {
      console.log(bad(`✗  ${c.text}  (${c.why})`));
      for (const m of mismatches) console.log(`     ${m}`);
      if (got.notes) console.log(dim(`     notes: ${got.notes}`));
      failed++;
    }
  }

  console.log("");
  console.log(`${passed} passed, ${failed} failed (of ${CASES.length})`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

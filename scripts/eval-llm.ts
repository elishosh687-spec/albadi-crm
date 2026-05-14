/**
 * LLM eval — measures classifier accuracy on hand-crafted phrasings.
 *   npx tsx scripts/eval-llm.ts
 *
 * Each phrase has an expected intent. We call classifyIntent, compare,
 * print:
 *   - per-class precision / recall
 *   - confusion matrix
 *   - list of every misclassification (phrase, expected, got, summary)
 *
 * Cost: ~120 LLM calls @ gpt-4o-mini ≈ $0.02 USD. No DB writes.
 */
import "dotenv/config";
import { classifyIntent, type Intent } from "../lib/autoresponder/intent";

interface Case {
  phrase: string;
  expected: Intent;
}

const CASES: Case[] = [
  // accept (8)
  { phrase: "מתאים", expected: "accept" },
  { phrase: "סבבה", expected: "accept" },
  { phrase: "אוקיי", expected: "accept" },
  { phrase: "אישור", expected: "accept" },
  { phrase: "בא נסגור", expected: "accept" },
  { phrase: "מעולה איך מזמינים?", expected: "accept" },
  { phrase: "מקובל עליי", expected: "accept" },
  { phrase: "כן בוא נמשיך", expected: "accept" },

  // reject (8) — saying no without mentioning price
  { phrase: "לא תודה", expected: "reject" },
  { phrase: "לא מעוניין", expected: "reject" },
  { phrase: "לא בשבילי", expected: "reject" },
  { phrase: "אני אחפש במקום אחר", expected: "reject" },
  { phrase: "תודה, לא מתאים לי", expected: "reject" },
  { phrase: "פאס", expected: "reject" },
  { phrase: "נמצא משהו אחר בינתיים", expected: "reject" },
  { phrase: "לא רלוונטי כרגע", expected: "reject" },

  // negotiating (15) — price-related; the most diverse class
  { phrase: "יקר", expected: "negotiating" },
  { phrase: "יקר מדי", expected: "negotiating" },
  { phrase: "ביוקר", expected: "negotiating" },
  { phrase: "המחיר גבוה", expected: "negotiating" },
  { phrase: "אפשר הנחה?", expected: "negotiating" },
  { phrase: "תוריד את המחיר", expected: "negotiating" },
  { phrase: "זה הרבה כסף", expected: "negotiating" },
  { phrase: "אצל המתחרה זה זול יותר", expected: "negotiating" },
  { phrase: "אפשר זול יותר?", expected: "negotiating" },
  { phrase: "תוכלו לרדת ל-800?", expected: "negotiating" },
  { phrase: "המחיר לא בתקציב שלי", expected: "negotiating" },
  { phrase: "יש לכם משהו זול יותר?", expected: "negotiating" },
  { phrase: "תורידו 20%", expected: "negotiating" },
  { phrase: "מצאתי הצעה ב-700", expected: "negotiating" },
  { phrase: "יקר לי כרגע", expected: "negotiating" },

  // samples_request (5)
  { phrase: "יש דוגמאות?", expected: "samples_request" },
  { phrase: "קטלוג?", expected: "samples_request" },
  { phrase: "אפשר לראות תמונות?", expected: "samples_request" },
  { phrase: "תוכלו לשלוח לי דוגמאות מוצרים?", expected: "samples_request" },
  { phrase: "יש לכם תיק מוצרים?", expected: "samples_request" },

  // custom_size (10) — different qty/size/spec
  { phrase: "אני רוצה 7500 יחידות", expected: "custom_size" },
  { phrase: "בגודל 25x10x35", expected: "custom_size" },
  { phrase: "אפשר 2 צבעים במקום 3?", expected: "custom_size" },
  { phrase: "רוצה מידה אחרת", expected: "custom_size" },
  { phrase: "אפשר ללא ידיות?", expected: "custom_size" },
  { phrase: "אני צריך 25×10×35 ס״מ", expected: "custom_size" },
  { phrase: "במקום 5000 בא לי 8000", expected: "custom_size" },
  { phrase: "אפשר מידה גדולה יותר?", expected: "custom_size" },
  { phrase: "תוסיף עוד צבע", expected: "custom_size" },
  { phrase: "פחות צבעים", expected: "custom_size" },

  // question_delivery (8)
  { phrase: "כמה זמן ייקח?", expected: "question_delivery" },
  { phrase: "מתי תגיע הסחורה?", expected: "question_delivery" },
  { phrase: "כמה זמן אקספרס?", expected: "question_delivery" },
  { phrase: "מתי?", expected: "question_delivery" },
  { phrase: "אפשר תוך שבוע?", expected: "question_delivery" },
  { phrase: "כמה זמן ייקח עד שאקבל את ההזמנה?", expected: "question_delivery" },
  { phrase: "מתי הסחורה מוכנה?", expected: "question_delivery" },
  { phrase: "באיזה זמן תוכלו לספק?", expected: "question_delivery" },

  // question_inclusive (8)
  { phrase: "המחיר כולל הכל?", expected: "question_inclusive" },
  { phrase: "כולל משלוח?", expected: "question_inclusive" },
  { phrase: "המחיר סופי?", expected: "question_inclusive" },
  { phrase: "יש מע״מ נוסף?", expected: "question_inclusive" },
  { phrase: "כולל הדפסה?", expected: "question_inclusive" },
  { phrase: "המחיר כולל הכנת לוגו?", expected: "question_inclusive" },
  { phrase: "יש עוד עלויות?", expected: "question_inclusive" },
  { phrase: "האם המחיר סופי או יש תוספות?", expected: "question_inclusive" },

  // question_payment (8)
  { phrase: "איך משלמים?", expected: "question_payment" },
  { phrase: "תנאי תשלום?", expected: "question_payment" },
  { phrase: "צריך מקדמה?", expected: "question_payment" },
  { phrase: "כמה אחוז להזמנה?", expected: "question_payment" },
  { phrase: "אפשר אשראי?", expected: "question_payment" },
  { phrase: "מתי משלמים?", expected: "question_payment" },
  { phrase: "אפשר תשלומים?", expected: "question_payment" },
  { phrase: "צ׳ק או העברה?", expected: "question_payment" },

  // question_format (8)
  { phrase: "באיזה פורמט לשלוח לוגו?", expected: "question_format" },
  { phrase: "PDF או JPG?", expected: "question_format" },
  { phrase: "וקטור או רגיל?", expected: "question_format" },
  { phrase: "באיזה גודל?", expected: "question_format" },
  { phrase: "צריך לוגו ברזולוציה גבוהה?", expected: "question_format" },
  { phrase: "איזה קובץ אתם רוצים ללוגו?", expected: "question_format" },
  { phrase: "אילוסטרייטור או פוטושופ?", expected: "question_format" },
  { phrase: "באיזה פורמט?", expected: "question_format" },

  // question_meeting (8)
  { phrase: "אפשר לדבר עם מישהו?", expected: "question_meeting" },
  { phrase: "אפשר בן-אדם?", expected: "question_meeting" },
  { phrase: "תתקשרו אליי", expected: "question_meeting" },
  { phrase: "אפשר להיפגש?", expected: "question_meeting" },
  { phrase: "תני לי לדבר עם נציג", expected: "question_meeting" },
  { phrase: "אפשר טלפון של איש מכירות?", expected: "question_meeting" },
  { phrase: "פגישה?", expected: "question_meeting" },
  { phrase: "תתקשר אליי 050-1234567", expected: "question_meeting" },

  // question_other (8) — factual but not in canned categories
  { phrase: "מאיזה חומר השקיות?", expected: "question_other" },
  { phrase: "יש אחריות?", expected: "question_other" },
  { phrase: "איך נראית ההדפסה?", expected: "question_other" },
  { phrase: "המפעל בארץ?", expected: "question_other" },
  { phrase: "אפשר עיצוב מותאם?", expected: "question_other" },
  { phrase: "השקיות מתכלות?", expected: "question_other" },
  { phrase: "האם השקית עמידה?", expected: "question_other" },
  { phrase: "יש בדיקות איכות?", expected: "question_other" },

  // other (15) — chit-chat / ambiguous / soft pause
  { phrase: "תודה", expected: "other" },
  { phrase: "אוקיי אחזור אליך", expected: "other" },
  { phrase: "אבדוק ואחזור", expected: "other" },
  { phrase: "תן לי לחשוב", expected: "other" },
  { phrase: "אני אבדוק עם השותף", expected: "other" },
  { phrase: "בוקר טוב", expected: "other" },
  { phrase: "🙏", expected: "other" },
  { phrase: "תן לי יום-יומיים", expected: "other" },
  { phrase: "אחזור אליך בעוד שעה", expected: "other" },
  { phrase: "תודה רבה", expected: "other" },
  { phrase: "סבבה אחזור אליך אחר כך", expected: "other" },
  { phrase: "לילה טוב", expected: "other" },
  { phrase: "אעדכן אותך", expected: "other" },
  { phrase: "👌", expected: "other" },
  { phrase: "תוך כמה ימים אחליט", expected: "other" },
];

interface RunResult {
  phrase: string;
  expected: Intent;
  got: Intent;
  confidence: number;
  summary?: string;
}

async function main(): Promise<void> {
  const results: RunResult[] = [];
  let n = 0;
  for (const c of CASES) {
    n++;
    const r = await classifyIntent({
      inboundText: c.phrase,
      pipelineStage: "AWAITING_DECISION",
    });
    results.push({
      phrase: c.phrase,
      expected: c.expected,
      got: r.intent,
      confidence: r.confidence,
      summary: r.summary,
    });
    process.stdout.write(
      `[${String(n).padStart(3)}/${CASES.length}] ${r.intent === c.expected ? "✓" : "✗"} ` +
        `${c.expected.padEnd(20)} → ${r.intent.padEnd(20)}  ${c.phrase}\n`
    );
  }

  // Per-class precision / recall
  const intents = Array.from(
    new Set([...results.map((r) => r.expected), ...results.map((r) => r.got)])
  ).sort();

  console.log("\n=== Per-class metrics ===\n");
  console.log(
    `${"intent".padEnd(22)} ${"support".padStart(8)} ${"correct".padStart(8)}` +
      ` ${"precision".padStart(10)} ${"recall".padStart(10)}`
  );
  for (const intent of intents) {
    const support = results.filter((r) => r.expected === intent).length;
    const got = results.filter((r) => r.got === intent).length;
    const tp = results.filter((r) => r.got === intent && r.expected === intent).length;
    const precision = got > 0 ? tp / got : 0;
    const recall = support > 0 ? tp / support : 0;
    console.log(
      `${intent.padEnd(22)} ${String(support).padStart(8)} ${String(tp).padStart(8)}` +
        ` ${(precision * 100).toFixed(0).padStart(9)}% ${(recall * 100).toFixed(0).padStart(9)}%`
    );
  }

  const totalCorrect = results.filter((r) => r.got === r.expected).length;
  console.log(
    `\nOverall accuracy: ${totalCorrect}/${results.length} = ${((totalCorrect / results.length) * 100).toFixed(1)}%\n`
  );

  // Confusion matrix
  console.log("=== Confusion matrix (rows=expected, cols=predicted) ===\n");
  const headerCols = intents.map((i) => i.slice(0, 8).padEnd(9)).join(" ");
  console.log(`${"".padEnd(22)} ${headerCols}`);
  for (const exp of intents) {
    const row = intents
      .map((pred) => {
        const n = results.filter((r) => r.expected === exp && r.got === pred).length;
        return (n > 0 ? String(n) : ".").padEnd(9);
      })
      .join(" ");
    console.log(`${exp.padEnd(22)} ${row}`);
  }

  // Misclassifications detail
  const miss = results.filter((r) => r.got !== r.expected);
  if (miss.length > 0) {
    console.log("\n=== Misclassifications ===\n");
    for (const m of miss) {
      console.log(
        `  "${m.phrase}"\n    expected: ${m.expected}  got: ${m.got}  (conf=${m.confidence.toFixed(2)})${
          m.summary ? `\n    summary: ${m.summary}` : ""
        }\n`
      );
    }
  }
}

main().catch((e) => {
  console.error("eval crashed:", e);
  process.exit(1);
});

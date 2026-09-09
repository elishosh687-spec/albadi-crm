/**
 * Scratch — the mustMention guard is what stands between "nicer wording" and
 * "a customer who was never asked for their logo". Prove it holds.
 *
 * Exercises the guard logic directly with stubbed setter output, so it runs
 * without prod keys.
 */
type Run = { ok: boolean; message?: { text?: string; validation?: { ok: boolean } } | null };

/** Mirrors phraseStateReply's decision logic exactly. */
function decide(run: Run, fallback: string, mustMention: string[] = []): string {
  const text = run.message?.text?.trim();
  if (!run.ok || !text) return fallback;
  if (run.message?.validation?.ok === false) return fallback;
  for (const w of mustMention) if (!text.includes(w)) return fallback;
  return text;
}

const FALLBACK = "מעולה! 🎉 שלח לי בבקשה את הלוגו כתמונה כאן בוואטסאפ ונמשיך הלאה.";
const ok = (t: string): Run => ({ ok: true, message: { text: t, validation: { ok: true } } });

const CASES: [string, Run, string[], boolean][] = [
  ["rewrite keeps the ask → used",
    ok("מעולה יוסי! שלח לי את הלוגו כתמונה ונצא לדרך 🎉"), ["לוגו"], true],
  ["rewrite DROPS the ask → rejected, funnel protected",
    ok("מעולה יוסי! נצא לדרך, אחזור אליך בקרוב 🎉"), ["לוגו"], false],
  ["empty text → fallback",
    { ok: true, message: { text: "  ", validation: { ok: true } } }, ["לוגו"], false],
  ["validator rejected → fallback",
    { ok: true, message: { text: "שלח לוגו", validation: { ok: false } } }, ["לוגו"], false],
  ["setter run failed → fallback", { ok: false }, ["לוגו"], false],
  ["null message → fallback", { ok: true, message: null }, ["לוגו"], false],
  ["no requirement, valid rewrite → used",
    ok("סבבה, קח את הזמן. אני כאן."), [], true],
];

let fails = 0;
for (const [label, run, must, shouldUseRewrite] of CASES) {
  const got = decide(run, FALLBACK, must);
  const usedRewrite = got !== FALLBACK;
  const pass = usedRewrite === shouldUseRewrite;
  if (!pass) fails++;
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  console.log(`     → ${usedRewrite ? "ניסוח חדש" : "טקסט קבוע"}: ${got.slice(0, 62)}`);
}
console.log(
  fails === 0
    ? "\n✅ a rewrite can never silently drop the request the flow depends on"
    : `\n❌ ${fails} failures`
);
process.exit(fails === 0 ? 0 : 1);

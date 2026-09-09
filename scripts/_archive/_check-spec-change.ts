/**
 * Replay the two messages רוברטו בגדדי actually sent, against the live
 * extractor, and assert the routing decision each one now produces.
 */
import { extractSpecFromText, hasAnyField } from "@/lib/autoresponder/spec-extractor";

const cases = [
  { text: "5,000 יחידות", want: "apply" },
  { text: "כמות", want: "ask" },
  { text: "בלי ידיות", want: "apply" },
  { text: "לא יודע מה", want: "ask" },
];

(async () => {
  let bad = 0;
  for (const c of cases) {
    const ex = await extractSpecFromText({ text: c.text });
    const has = ex ? hasAnyField(ex) : false;
    const got = has ? "apply" : "ask";
    const ok = got === c.want;
    if (!ok) bad++;
    console.log(
      `${ok ? "ok  " : "FAIL"}  "${c.text}" → ${got}` +
        `   [qty=${ex?.quantity ?? "-"} custom=${ex?.quantityCustom ?? "-"} ` +
        `handles=${ex?.handles ?? "-"} notes=${ex?.notes ? "yes" : "-"}]`
    );
  }
  console.log(bad === 0 ? "\nALL PASS" : `\n${bad} FAILED`);
  process.exit(bad === 0 ? 0 : 1);
})();

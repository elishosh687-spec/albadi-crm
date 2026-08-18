/**
 * Paced analyzer — one lead at a time with spacing to respect a low OpenAI TPM
 * tier. Rate-limited leads soft-fail without persisting, so re-looping retries
 * them. Run: OPENAI_API_KEY=... DATABASE_URL=... npx tsx scripts/_run-analysis-paced.ts [all]
 */
import { selectMatched, type LeadFilter } from "@/lib/analysis/batch";
import { analyzeLead } from "@/lib/analysis/analyze-lead";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SPACING_MS = 16000;

async function main() {
  const filter: LeadFilter = process.argv[2] === "all" ? {} : { withCalls: true };
  for (let round = 1; round <= 4; round++) {
    const matched = await selectMatched(filter);
    const todo = matched.filter((m) => !m.analyzed).map((m) => m.sid);
    console.log(`\n=== round ${round}: ${todo.length} unanalyzed (of ${matched.length}) ===`);
    if (!todo.length) break;
    for (const sid of todo) {
      try {
        const r = await analyzeLead(sid, { force: false });
        const v = r?.verdict;
        console.log(`  ${v?.name ?? sid}: ${v?.insufficient_data ? "THIN/FAIL(retry)" : v?.primary_blocker}`);
      } catch (e) {
        console.log(`  ${sid} ERR ${String(e).slice(0, 60)}`);
      }
      await sleep(SPACING_MS);
    }
  }
  console.log("DONE");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

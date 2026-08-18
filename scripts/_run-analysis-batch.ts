/**
 * One-off: run the real analyzer over leads (default: those with calls).
 * Usage: OPENAI_API_KEY=... DATABASE_URL=... npx tsx scripts/_run-analysis-batch.ts [all]
 * Populates lead_analyses with real gpt-4o verdicts (grounding-checked).
 */
import { analyzeBatch, type LeadFilter } from "@/lib/analysis/batch";

async function main() {
  const all = process.argv[2] === "all";
  const filter: LeadFilter = all ? {} : { withCalls: true };
  let round = 0;
  while (true) {
    round++;
    const p = await analyzeBatch(filter, 60, false);
    console.log(
      `round ${round}: total=${p.total} before=${p.analyzed_before} processed=${p.processed} after=${p.analyzed_after} remaining=${p.remaining}`
    );
    const errs = p.results.filter((r) => !r.ok);
    if (errs.length) console.log("  errors:", JSON.stringify(errs.slice(0, 5)));
    if (p.remaining === 0 || p.processed === 0) break;
  }
  console.log("DONE");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * One-off analysis: percentage breakdown of customer answers per questionnaire field.
 * Goal: decide which questions can be removed (low variance = remove + default in calc).
 *
 * Sources:
 *   - leads.q_state (current FSM state; may be partial/in-progress)
 *   - bot_quotes.q_state (frozen snapshot at quote-send time; clean, completed)
 *
 * We treat bot_quotes as the "high-signal" cohort (these answers led to a real quote).
 * leads is shown alongside for breadth, including in-progress / bailed.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { leads, botQuotes } from "../drizzle/schema";
import { sql } from "drizzle-orm";

type AnyState = Record<string, any>;

const FIELDS = ["shipping", "quantity", "product", "handles", "lamination", "colors"] as const;

function tally(states: AnyState[], field: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of states) {
    if (!s || typeof s !== "object") continue;
    const v = s[field];
    if (v === undefined || v === null || v === "") continue;
    counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  }
  return counts;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return ((part / whole) * 100).toFixed(1) + "%";
}

function printBreakdown(label: string, states: AnyState[]) {
  console.log(`\n========== ${label} — total rows: ${states.length} ==========`);
  for (const f of FIELDS) {
    const counts = tally(states, f);
    const answered = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`\n  ▸ ${f}  (answered: ${answered}/${states.length} = ${pct(answered, states.length)})`);
    if (sorted.length === 0) {
      console.log("      (no data)");
      continue;
    }
    for (const [val, n] of sorted) {
      console.log(`      ${val.padEnd(12)} ${String(n).padStart(5)}   ${pct(n, answered)}`);
    }
  }
}

async function main() {
  // ---- Source 1: bot_quotes (initial quotes only — requotes mutate state) ----
  const quoteRows = await db
    .select({ qState: botQuotes.qState, source: botQuotes.source })
    .from(botQuotes)
    .where(sql`${botQuotes.source} = 'initial'`);
  const quoteStates: AnyState[] = quoteRows.map((r) => r.qState as AnyState);

  // ---- Source 2: leads.q_state — any lead that has any qState ----
  const leadRows = await db
    .select({ qState: leads.qState, stage: leads.pipelineStage })
    .from(leads)
    .where(sql`${leads.qState} IS NOT NULL`);
  const leadStates: AnyState[] = leadRows.map((r) => r.qState as AnyState);

  // ---- Completed leads cohort: doneAt set (questionnaire finished, quote went out) ----
  const completedStates = leadStates.filter((s) => s && s.doneAt);

  // ---- Cohort that REACHED each step (denominator nuance) ----
  // For "handles" (step 6) and "lamination" (step 7), the denominator should be
  // "everyone who reached that step or beyond" — not everyone who started.
  // Anyone with the field present reached it; that's what `tally`'s "answered"
  // already captures. We just need to know whether the % within answerers is
  // skewed enough to drop the question.

  printBreakdown("bot_quotes (initial quotes only)", quoteStates);
  printBreakdown("leads.q_state (ALL — incl in-progress + bailed)", leadStates);
  printBreakdown("leads.q_state (COMPLETED only — doneAt set)", completedStates);

  // ---- Cross-tab: handles × shipping (would handle decision change by shipping mode?) ----
  console.log("\n========== Cross-tab: handles × shipping (completed leads) ==========");
  const xtab = new Map<string, Map<string, number>>();
  for (const s of completedStates) {
    const h = String(s.handles ?? "—");
    const sh = String(s.shipping ?? "—");
    if (!xtab.has(h)) xtab.set(h, new Map());
    xtab.get(h)!.set(sh, (xtab.get(h)!.get(sh) ?? 0) + 1);
  }
  for (const [h, m] of xtab) {
    const tot = Array.from(m.values()).reduce((a, b) => a + b, 0);
    const parts = Array.from(m.entries())
      .map(([sh, n]) => `${sh}:${n} (${pct(n, tot)})`)
      .join("  ");
    console.log(`  handles=${h.padEnd(8)} total=${tot}   ${parts}`);
  }

  // ---- Cross-tab: lamination × handles ----
  console.log("\n========== Cross-tab: lamination × handles (completed leads) ==========");
  const xtab2 = new Map<string, Map<string, number>>();
  for (const s of completedStates) {
    const l = String(s.lamination ?? "—");
    const h = String(s.handles ?? "—");
    if (!xtab2.has(l)) xtab2.set(l, new Map());
    xtab2.get(l)!.set(h, (xtab2.get(l)!.get(h) ?? 0) + 1);
  }
  for (const [l, m] of xtab2) {
    const tot = Array.from(m.values()).reduce((a, b) => a + b, 0);
    const parts = Array.from(m.entries())
      .map(([h, n]) => `handles=${h}:${n} (${pct(n, tot)})`)
      .join("  ");
    console.log(`  lamination=${l.padEnd(8)} total=${tot}   ${parts}`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

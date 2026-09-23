/**
 * Before/after for "learn plain-bag prices from factory quotes" (FitOpts.learnPlain)
 * + a per-quote error table. Every quote is scored by a model fitted WITHOUT it.
 * READ-ONLY: Feishu + DB reads, writes nothing, sends nothing.
 *
 *   DATABASE_URL=… npx tsx --env-file=.env scripts/estimator-before-after.ts [out.json]
 *
 * Result 2026-09-22 (33 unique quotes): learning plain from quotes gave no gain
 * (median 4.5% → 5.1%, same worst case), so the live refit keeps it OFF. Re-run
 * when more gusseted plain quotes exist — see docs/agent/pricing.md.
 */
import { extractFeishu, buildModel, predict, dimsStr, dedupeQuotes, quoteKey, FACS, MAX_QTY, pct, type Pt, type FitOpts } from "@/lib/factory/server/estimator-fit";
import { dbQuotePoints } from "@/lib/factory/server/refit-estimator";
import { writeFileSync } from "node:fs";

async function main() {
  const { cat, ql: qlRaw } = await extractFeishu();
  const { points: db } = await dbQuotePoints();
  const all = dedupeQuotes([...qlRaw, ...db]).filter((p) => (FACS as readonly string[]).includes(p.factory) && p.qty >= 3000 && p.qty <= MAX_QTY);
  const run = (opts: FitOpts) => all.map((p) => {
    const m = buildModel(cat, all, p.factory, quoteKey(p), opts);   // honest leave-one-out for every quote
    const pr = predict(m, p);
    const inRange = pr?.conf === "high";
    return pr ? { err: (pr.unit - p.price) / p.price * 100, inRange, unit: pr.unit } : null;
  });
  const before = run({}), after = run({ learnPlain: true });
  const rows = all.map((p, i) => {
    const dm = dimsStr(p.size)!;
    return { size: `H${dm.h}×W${dm.w}×D${dm.d}`, h: dm.h, w: dm.w, d: dm.d, area: Math.round(p.area), ratio: +(dm.h / dm.w).toFixed(2),
      factory: p.factory, lam: p.hasLam, handle: p.hasHandle, colors: p.colors, qty: p.qty, price: +p.price.toFixed(3),
      before: before[i]?.err ?? null, beforeIn: before[i]?.inRange ?? false, after: after[i]?.err ?? null, afterIn: after[i]?.inRange ?? false,
      narrowTall: dm.d > 0 && dm.d <= 10 && dm.h >= 1.5 * dm.w };
  });
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(rows, null, 1));
  const summ = (label: string, xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); const s = pct(v); console.log(`${label}: n=${s.n} חציון ${s.median.toFixed(1)}% · p90 ${s.p90.toFixed(1)}% · מקס ${s.max.toFixed(0)}% · ממוצע חתום ${s.mean.toFixed(1)}%`); };
  console.log(`quotes (deduped, Mandy/亚森, 3k–10k): ${all.length} — plain ${all.filter(p=>!p.hasLam).length}, lam ${all.filter(p=>p.hasLam).length}`);
  for (const [lbl, f] of [["כל ההצעות", (_: typeof rows[0]) => true], ["רגילות", (r: typeof rows[0]) => !r.lam], ["למינציה", (r: typeof rows[0]) => r.lam], ["רגילות, לא צר-וגבוה", (r: typeof rows[0]) => !r.lam && !r.narrowTall]] as const) {
    const sel = rows.filter(f);
    console.log(`\n== ${lbl} (${sel.length})`);
    summ("  לפני (כל הצורות)", sel.map((r) => r.before)); summ("  אחרי (כל הצורות)", sel.map((r) => r.after));
    summ("  לפני (רק מה שהוא מסכים לתמחר)", sel.filter((r) => r.beforeIn && !r.narrowTall).map((r) => r.before));
    summ("  אחרי (רק מה שהוא מסכים לתמחר)", sel.filter((r) => r.afterIn && !r.narrowTall).map((r) => r.after));
  }
  process.exit(0);
}
main();

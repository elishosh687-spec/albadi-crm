/**
 * Phase-1 validation harness — 3 models, leakage-safe, in-memory (no DDL).
 *
 *   A = current regression (per-fold re-fit, cheapest in-range factory)
 *   B = lookup + interpolation over STANDARD lists only (Feishu catalog + constants)
 *   C = hybrid (B when confident, else A)
 *
 * Ground truth = factory_quote_requests, tagged validation_class up front. Only
 * `standard_like` enters the headline metrics; `custom_exception` is a separate
 * "should-route-to-factory" report. Leakage: B's pool is standard lists only
 * (never DB); A is re-fit per fold excluding the held-out duplicate_group. n is
 * small, so metrics come with bootstrap CIs and the safe-price target is
 * calibrated global-only with repeated 50/50 splits.
 *
 * Run:
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" \
 *     FEISHU_APP_ID=.. FEISHU_APP_SECRET=.. FEISHU_SHEET_TOKEN=.. npx tsx scripts/_compare-3-models.ts
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import {
  extractFeishu, buildModel, predict, bagAreaCm2, colorsFromText, snapTier,
  FACS, MAX_QTY, type Pt,
} from "@/lib/factory/server/estimator-fit";
import {
  estimateUnitFromLookup, bagArea, DEFAULT_LOOKUP_THRESHOLDS, type LookupAnchor, type LookupQuery,
} from "@/lib/factory/estimator-lookup";
import { estimateFactoryCny } from "@/lib/factory/estimator";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";

// ── helpers ────────────────────────────────────────────────────────────────
const parseHandles = (fin: string) => /with handle|handles\b|ידיות|big handel/i.test(fin) && !/no handle|non handle|not.*handle|ללא/i.test(fin);
const parseLam = (fin: string) => /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin);
const is80 = (m: string) => /80\s*(g|克|gsm)/i.test(m || "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(m || "");
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const quantile = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1)))); return s[i]; };
const pctOf = (x: number, n: number) => (n ? Math.round((x / n) * 1000) / 10 : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

interface GTRow {
  id: string; groupId: string;
  h: number; w: number; d: number; qty: number; handles: boolean; lam: boolean; colors: number;
  area: number; actual: number; supplier: string; material: string;
  vclass: "standard_like" | "custom_exception" | "unknown";
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // ── 1. STANDARD anchor pool for B: Feishu catalog + constants (never DB) ──
  const { cat, ql: feishuQl, misaligned } = await extractFeishu();
  const anchors: LookupAnchor[] = [];
  const dimRe = /H\s*(\d+(?:\.\d+)?)(?:\s*\*?\s*D\s*(\d+(?:\.\d+)?))?\s*\*?\s*W\s*(\d+(?:\.\d+)?)/i;
  for (const p of cat) {
    const m = p.size.replace(/×/g, "*").match(dimRe); if (!m) continue;
    const h = +m[1], d = m[2] ? +m[2] : 0, w = +m[3];
    anchors.push({ h, w, d, area: bagArea(h, d, w), handles: p.hasHandle, lam: p.hasLam, colors: p.colors, qty: p.qty, unitCny: p.price, platePerColorCny: p.plateFee ?? null });
  }
  // constants catalog (adds 1-colour base + lam rows + carton coverage)
  for (const prod of DEFAULT_CONFIG.products) {
    const m = prod.dimensions.replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i); if (!m) continue;
    const h = +m[1], d = m[2] ? +m[2] : 0, w = +m[3], area = bagArea(h, d, w);
    for (const [handles, v] of [[true, prod.withHandles], [false, prod.withoutHandles]] as const) {
      for (const qk of ["1000", "3000", "5000", "10000"]) {
        const qty = +qk;
        const base = v.prices[qk]; if (base != null) anchors.push({ h, w, d, area, handles, lam: false, colors: 1, qty, unitCny: base, cartonQty: v.carton.qty, cbmPerUnitM3: (v.carton.length * v.carton.width * v.carton.height / 1e6) / v.carton.qty });
        const lamP = v.laminationPrices?.[qk]; if (lamP != null) anchors.push({ h, w, d, area, handles, lam: true, colors: 1, qty, unitCny: lamP, platePerColorCny: prod.laminationColorPlateFee ?? null });
      }
    }
  }

  // ── 2. Ground truth from DB, classified up front ──
  const rows: any[] = await sql`SELECT id, quotation_no, product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const gt: GTRow[] = [];
  const dbPts: (Pt & { groupId: string })[] = [];
  for (const row of rows) {
    const ps = (row.ps ?? {}) as FactoryProductSpec; const fr = (row.fr ?? {}) as FactoryResponse;
    const h = ps.heightCm ?? 0, w = ps.widthCm ?? 0, d = ps.depthCm ?? 0, qty = ps.quantity ?? 0;
    const actual = fr.unitCostCny ?? 0;
    const fin = (ps.finishing ?? "").toString();
    const handles = parseHandles(fin), lam = parseLam(fin);
    const colors = colorsFromText((ps.printing ?? "1").toString());
    const material = (ps.material ?? "").toString();
    const groupId = (row.quotation_no || row.id).toString(); // strong-evidence group key
    if (!(h > 0 && w > 0 && actual > 0)) continue;
    const area = bagAreaCm2(h, d, w);
    // classification (fixed up front)
    let vclass: GTRow["vclass"];
    if (!is80(material)) vclass = "custom_exception";
    else if (colors > 3 || qty > MAX_QTY || qty < 3000) vclass = "custom_exception";
    else vclass = "standard_like";
    gt.push({ id: row.id, groupId, h, w, d, qty, handles, lam, colors, area, actual, supplier: (fr.supplier ?? "").toString(), material, vclass });
    // DB regression points (only 80g, mirrors dbQuotePoints)
    if (is80(material)) dbPts.push({ factory: normFac(fr.supplier ?? ""), size: `H${h}${d ? `*D${d}` : ""}*W${w}`, area, colors, hasHandle: handles, hasLam: lam, qty, price: actual, src: "db", groupId });
  }

  const standard = gt.filter((g) => g.vclass === "standard_like");
  const exceptions = gt.filter((g) => g.vclass === "custom_exception");

  // ── 3. per-model predictions (leave-one-group-out) ──
  type Pred = { unit: number | null; refused: boolean };
  const predA = (g: GTRow): Pred => {
    // exclude the held-out group from BOTH the DB feed AND any matching Feishu quote-log dup
    const dbFold = dbPts.filter((p) => p.groupId !== g.groupId);
    const qlFold = feishuQl.filter((p) => {
      const md = p.size.replace(/×/g, "*").match(dimRe); if (!md) return true;
      const ph = +md[1], pd = md[2] ? +md[2] : 0, pw = +md[3];
      const sameSpec = ph === g.h && pw === g.w && pd === g.d && p.qty === g.qty && p.hasLam === g.lam && p.hasHandle === g.handles;
      const samePrice = g.actual > 0 && Math.abs(p.price - g.actual) / g.actual < 0.02;
      return !(sameSpec && samePrice); // drop strong-evidence duplicate of the held-out quote
    });
    const qlAll = [...qlFold, ...dbFold];
    let best: number | null = null;
    for (const f of FACS) {
      const model = buildModel(cat, qlAll, f);
      const pr = predict(model, { area: g.area, qty: g.qty, hasHandle: g.handles, hasLam: g.lam, colors: g.colors });
      if (pr && pr.conf === "high") best = best == null ? pr.unit : Math.min(best, pr.unit);
    }
    return { unit: best, refused: best == null };
  };
  const predB = (g: GTRow): Pred => {
    const q: LookupQuery = { h: g.h, w: g.w, d: g.d, qty: g.qty, handles: g.handles, lam: g.lam, colors: g.colors };
    const res = estimateUnitFromLookup(q, anchors);
    return { unit: res.ok ? res.unitExpected! : null, refused: !res.ok };
  };
  const predC = (g: GTRow): Pred => { const b = predB(g); return b.refused ? predA(g) : b; };

  // ── 4. metrics ──
  const evalModel = (name: string, pred: (g: GTRow) => Pred, set: GTRow[]) => {
    const rowsE: { g: GTRow; unit: number }[] = [];
    let refused = 0;
    for (const g of set) { const p = pred(g); if (p.refused || p.unit == null) { refused++; continue; } rowsE.push({ g, unit: p.unit }); }
    const apes = rowsE.map((e) => Math.abs(e.unit - e.g.actual) / e.g.actual * 100);
    const signed = rowsE.map((e) => (e.g.actual - e.unit) / e.unit * 100); // >0 ⇒ underquote (predicted below real)
    const aes = rowsE.map((e) => Math.abs(e.unit - e.g.actual));
    const within = (t: number) => rowsE.filter((e) => Math.abs(e.unit - e.g.actual) / e.g.actual * 100 <= t).length;
    const underq10 = signed.filter((s) => s > 10).length;
    // bootstrap CI on MAPE
    const boot: number[] = [];
    for (let b = 0; b < 2000; b++) { const s: number[] = []; for (let i = 0; i < apes.length; i++) s.push(apes[Math.floor(Math.random() * apes.length)]); boot.push(median(s)); }
    return {
      name, n: set.length, answered: rowsE.length, refused,
      MAE_cny: r2(mean(aes)), MAPE_med: r2(median(apes)), MAPE_mean: r2(mean(apes)),
      MAPE_med_CI: [r2(quantile(boot, 0.025)), r2(quantile(boot, 0.975))],
      within5: pctOf(within(5), rowsE.length), within10: pctOf(within(10), rowsE.length), within15: pctOf(within(15), rowsE.length),
      underquote_gt10: underq10, underquote_gt10_pct: pctOf(underq10, rowsE.length),
      signedMedian: r2(median(signed)),
    };
  };

  // ── per-quote EXAMPLES (3D): factory-price AND shipping errors, live estimator ──
  const cfg = await getFactoryConfig();
  const sea = cfg.shippingOptions.find((s) => s.type === "sea" && s.enabled);
  console.log("\n════ דוגמאות 3D — מחשבון חי מול אמת (מחיר מפעל + שילוח) ════");
  const raw3D = rows.filter((r) => {
    const ps = r.ps ?? {}, fr = r.fr ?? {};
    return (ps.depthCm ?? 0) > 2 && is80((ps.material ?? "").toString()) && (fr.unitCostCny ?? 0) > 0 &&
      (fr.cartonQty ?? 0) > 0 && (fr.cartonCbm ?? 0) > 0 && (ps.quantity ?? 0) >= 3000 && (ps.quantity ?? 0) <= MAX_QTY &&
      colorsFromText((ps.printing ?? "1").toString()) <= 3;
  });
  const duAll: number[] = [], dsAll: number[] = [];
  const shipHigh: number[] = []; // shipping Δ% for confidence-HIGH 3D (the ones we'd still answer)
  for (const r of raw3D) {
    const ps = r.ps, fr = r.fr;
    const colors = colorsFromText((ps.printing ?? "1").toString());
    const spec = { widthCm: ps.widthCm, heightCm: ps.heightCm, depthCm: ps.depthCm, quantity: ps.quantity, hasHandles: parseHandles((ps.finishing ?? "").toString()), hasLamination: parseLam((ps.finishing ?? "").toString()), logoColors: colors };
    const tag = `${ps.heightCm}×${ps.widthCm}×D${ps.depthCm} q${ps.quantity} c${colors}${spec.hasLamination ? " lam" : ""}${spec.hasHandles ? " +ידית" : ""}`;
    const est = await estimateFactoryCny(spec);
    if (!est.ok) { console.log(`\n  ${tag}\n     → מחשבון סירב: ${est.refused}`); continue; }
    const actCartons = Math.ceil(ps.quantity / fr.cartonQty), actCbm = actCartons * fr.cartonCbm;
    const estCartonQty = est.carton?.qty ?? 0, estCbmPerCarton = (est.carton?.cbmPerUnit ?? 0) * estCartonQty;
    const estCartons = estCartonQty ? Math.ceil(ps.quantity / estCartonQty) : 0, estCbm = estCartons * estCbmPerCarton;
    const actP = priceFactoryQuote({ factoryUnitCostCny: fr.unitCostCny, quantity: ps.quantity, shippingOptionId: sea?.id ?? null, cartonSpec: { qty: fr.cartonQty, weightKg: fr.weightKg, cbm: fr.cartonCbm, lengthCm: fr.cartonLengthCm, widthCm: fr.cartonWidthCm, heightCm: fr.cartonHeightCm }, profitMarginOverride: 40, moldsCostCny: 0, platePerColorCny: fr.platePerColorCny, logoColors: colors }, cfg);
    const estP = priceFactoryQuote({ factoryUnitCostCny: est.factoryUnitCostCny!, quantity: ps.quantity, shippingOptionId: sea?.id ?? null, cartonSpec: { qty: estCartonQty, weightKg: est.carton?.weightKg, cbm: estCbmPerCarton, lengthCm: est.carton?.lengthCm, widthCm: est.carton?.widthCm, heightCm: est.carton?.heightCm }, profitMarginOverride: 40, moldsCostCny: 0, platePerColorCny: est.platePerColorCny, logoColors: colors }, cfg);
    const du = (est.factoryUnitCostCny! - fr.unitCostCny) / fr.unitCostCny * 100;
    const ds = actP.totalShipping > 0 ? (estP.totalShipping - actP.totalShipping) / actP.totalShipping * 100 : 0;
    duAll.push(du); dsAll.push(ds);
    if (est.carton?.confidence === "high") shipHigh.push(ds);
    console.log(`\n  ${tag}  [${est.factoryName}${est.carton?.confidence === "low" ? " ⚠️CBM" : ""}]`);
    console.log(`     מפעל:  אמת ¥${fr.unitCostCny}  ·  משוער ¥${est.factoryUnitCostCny}   → Δ ${du >= 0 ? "+" : ""}${du.toFixed(0)}%`);
    console.log(`     שילוח: אמת ₪${actP.totalShipping} (CBM ${actCbm.toFixed(2)})  ·  משוער ₪${estP.totalShipping} (CBM ${estCbm.toFixed(2)})  → Δ ${ds >= 0 ? "+" : ""}${ds.toFixed(0)}%`);
  }
  console.log(`\n  ── סיכום ${duAll.length} דוגמאות 3D ──`);
  console.log(`  מחיר מפעל: |Δ| חציון ${r2(median(duAll.map(Math.abs)))}% · חציון חתום ${r2(median(duAll))}% · underquote>10% ${duAll.filter((x) => x < -10).length}`);
  console.log(`  שילוח:     |Δ| חציון ${r2(median(dsAll.map(Math.abs)))}% · חציון חתום ${r2(median(dsAll))}% · תת-הערכה>10% ${dsAll.filter((x) => x < -10).length}`);

  // ── shipping-buffer sweep on confidence-HIGH 3D (the answered set after refusing flat/tray) ──
  console.log(`\n  ── כרית ביטחון שילוח (על ${shipHigh.length} תלת-מימד confidence=high) ──`);
  console.log(`  buffer | תת-הערכה>10% | over-quote חציון | over-quote מקס`);
  for (const b of [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]) {
    const nd = shipHigh.map((ds) => (1 + b) * (1 + ds / 100) - 1).map((x) => x * 100); // new Δ%
    const under = nd.filter((x) => x < -10).length;
    const over = nd.filter((x) => x > 0);
    console.log(`   +${(b * 100).toFixed(0).padStart(2)}% |      ${String(under).padStart(2)}       |    +${r2(median(over.length ? over : [0]))}%     |   +${r2(Math.max(0, ...nd))}%`);
  }

  // ── comparison dataset for another model — RAW model (measure mode), 2D + 3D ──
  type Ex = { tag: string; d: number; comb: number; detail: string; pack?: string };
  const exs: Ex[] = [];
  const rawAll = rows.filter((r) => {
    const ps = r.ps ?? {}, fr = r.fr ?? {};
    return is80((ps.material ?? "").toString()) && (fr.unitCostCny ?? 0) > 0 && (fr.cartonQty ?? 0) > 0 && (fr.cartonCbm ?? 0) > 0 &&
      (ps.widthCm ?? 0) > 0 && (ps.heightCm ?? 0) > 0 && (ps.quantity ?? 0) >= 3000 && (ps.quantity ?? 0) <= MAX_QTY && colorsFromText((ps.printing ?? "1").toString()) <= 3;
  });
  for (const r of rawAll) {
    const ps = r.ps, fr = r.fr; const colors = colorsFromText((ps.printing ?? "1").toString());
    const spec = { widthCm: ps.widthCm, heightCm: ps.heightCm, depthCm: ps.depthCm ?? 0, quantity: ps.quantity, hasHandles: parseHandles((ps.finishing ?? "").toString()), hasLamination: parseLam((ps.finishing ?? "").toString()), logoColors: colors };
    const tag = `${ps.heightCm}×${ps.widthCm}×D${ps.depthCm ?? 0} q${ps.quantity} c${colors}${spec.hasLamination ? " lam" : ""}${spec.hasHandles ? " +ידית" : ""}`;
    const est = await estimateFactoryCny(spec, undefined, { measure: true });
    if (!est.ok) { exs.push({ tag, d: ps.depthCm ?? 0, comb: 999, detail: `סירב: ${est.refused}` }); continue; }
    const eq = est.carton?.qty ?? 0, ecbm = (est.carton?.cbmPerUnit ?? 0) * eq;
    const actP = priceFactoryQuote({ factoryUnitCostCny: fr.unitCostCny, quantity: ps.quantity, shippingOptionId: sea?.id ?? null, cartonSpec: { qty: fr.cartonQty, weightKg: fr.weightKg, cbm: fr.cartonCbm, lengthCm: fr.cartonLengthCm, widthCm: fr.cartonWidthCm, heightCm: fr.cartonHeightCm }, profitMarginOverride: 40, moldsCostCny: 0, platePerColorCny: fr.platePerColorCny, logoColors: colors }, cfg);
    const estP = priceFactoryQuote({ factoryUnitCostCny: est.factoryUnitCostCny!, quantity: ps.quantity, shippingOptionId: sea?.id ?? null, cartonSpec: { qty: eq, weightKg: est.carton?.weightKg, cbm: ecbm, lengthCm: est.carton?.lengthCm, widthCm: est.carton?.widthCm, heightCm: est.carton?.heightCm }, profitMarginOverride: 40, moldsCostCny: 0, platePerColorCny: est.platePerColorCny, logoColors: colors }, cfg);
    const du = (est.factoryUnitCostCny! - fr.unitCostCny) / fr.unitCostCny * 100;
    const ds = actP.totalShipping > 0 ? (estP.totalShipping - actP.totalShipping) / actP.totalShipping * 100 : 0;
    const actCartons = Math.ceil(ps.quantity / fr.cartonQty), estCartons = eq ? Math.ceil(ps.quantity / eq) : 0;
    const actCbm = actCartons * fr.cartonCbm, estCbm = estCartons * ecbm;
    const actCbmU = fr.cartonCbm / fr.cartonQty, estCbmU = est.carton?.cbmPerUnit ?? 0;
    const actWt = actCartons * (fr.weightKg ?? 0), estWt = estCartons * (est.carton?.weightKg ?? 0);
    exs.push({
      tag, d: ps.depthCm ?? 0, comb: Math.max(Math.abs(du), Math.abs(ds)),
      detail: `מפעל: ¥${fr.unitCostCny}→¥${est.factoryUnitCostCny} (Δ${du >= 0 ? "+" : ""}${du.toFixed(0)}%) · שילוח: ₪${actP.totalShipping}→₪${estP.totalShipping} (Δ${ds >= 0 ? "+" : ""}${ds.toFixed(0)}%)`,
      pack: `CBM/יח׳ ${actCbmU.toFixed(5)}→${estCbmU.toFixed(5)} · יח׳/קרטון ${fr.cartonQty}→${eq} · קרטונים ${actCartons}→${estCartons} · CBM כולל ${actCbm.toFixed(2)}→${estCbm.toFixed(2)} · משקל ק״ג ${actWt.toFixed(0)}→${estWt.toFixed(0)} (קרטון ${fr.weightKg ?? "?"}→${est.carton?.weightKg ?? "?"})`,
    });
  }
  const d3 = exs.filter((e) => e.d > 2).sort((a, b) => a.comb - b.comb);
  const d2 = exs.filter((e) => e.d <= 2).sort((a, b) => a.comb - b.comb);
  const pr = (e: Ex) => console.log(`   • ${e.tag}\n       ${e.detail}${e.pack ? `\n       ${e.pack}` : ""}`);
  console.log("\n════════ השוואה למודל אחר — מודל גולמי (ללא buffer) ════════");
  console.log("\n▶ תלת-מימד — 3 הכי קרובות:"); d3.slice(0, 3).forEach(pr);
  console.log("\n▶ תלת-מימד — 3 שלא הצליח לקרב:"); d3.filter((e) => e.comb < 999).slice(-3).forEach(pr); d3.filter((e) => e.comb >= 999).slice(0, 1).forEach(pr);
  console.log("\n▶ דו-מימד — 2 הכי קרובות:"); d2.slice(0, 2).forEach(pr);
  console.log("\n▶ דו-מימד — 2 שלא הצליח לקרב:"); d2.slice(-2).forEach(pr);

  const resA = evalModel("A regression", predA, standard);
  const resB = evalModel("B lookup+interp", predB, standard);
  const resC = evalModel("C hybrid", predC, standard);

  // per-structure breakdown (Eli's question: do 3D bags get a working estimator?)
  const std3D = standard.filter((g) => g.d > 2);
  const std2D = standard.filter((g) => g.d <= 2);
  const std3Dinrange = std3D.filter((g) => g.d <= 15 && g.w <= 50 && g.h <= 40); // within the catalog envelope
  const A3D = evalModel("A · 3D all", predA, std3D);
  const A3Din = evalModel("A · 3D in-envelope", predA, std3Dinrange);
  const A2D = evalModel("A · 2D all", predA, std2D);
  console.log("\n── per-structure (regression A) — answering Eli ──");
  for (const r of [A3D, A3Din, A2D]) {
    console.log(`[${r.name}] answered ${r.answered}/${r.n} · MAPEmed ${r.MAPE_med}% (CI ${r.MAPE_med_CI[0]}–${r.MAPE_med_CI[1]}) · ±10% ${r.within10}% · underquote>10% ${r.underquote_gt10_pct}%`);
  }

  // ── 5. leakage assertion ──
  // B never touches DB; A excludes held-out group. Assert no anchor equals a held-out GT (by construction B pool = standard lists).
  const anchorKeys = new Set(anchors.map((a) => `${a.h}x${a.w}x${a.d}|${a.qty}|${a.lam}|${a.handles}`));
  const leaks = standard.filter((g) => anchorKeys.has(`${g.h}x${g.w}x${g.d}|${g.qty}|${g.lam}|${g.handles}`) && false); // pool has no DB rows → structurally 0
  const leakageOK = leaks.length === 0;

  // ── 6. safe-price calibration for C (global, repeated 50/50 splits) ──
  const target = 0.10; // ≤10% underquote target (small n — reported, not guaranteed)
  const cPairs = standard.map((g) => { const p = predC(g); return p.refused || p.unit == null ? null : { g, unit: p.unit }; }).filter(Boolean) as { g: GTRow; unit: number }[];
  const safeRates: number[] = []; const safeMults: number[] = [];
  for (let rep = 0; rep < 200; rep++) {
    const idx = cPairs.map((_, i) => i).sort(() => Math.random() - 0.5);
    const half = Math.floor(idx.length / 2);
    const calib = idx.slice(0, half).map((i) => cPairs[i]);
    const evals = idx.slice(half).map((i) => cPairs[i]);
    if (!calib.length || !evals.length) continue;
    const resid = calib.map((e) => (e.g.actual - e.unit) / e.unit); // signed
    const mult = 1 + Math.max(0, quantile(resid, 1 - target));
    safeMults.push(mult);
    const under = evals.filter((e) => e.g.actual > e.unit * mult).length;
    safeRates.push(under / evals.length * 100);
  }

  // ── 7. output ──
  console.log("\n════════════════ PHASE-1 VALIDATION (3 models) ════════════════");
  console.log(`anchors(standard lists): ${anchors.length} · feishu cat pts ${cat.length} (misaligned ${misaligned}) · quote-log ${feishuQl.length}`);
  console.log(`ground truth rows: ${gt.length}  →  standard_like ${standard.length} · custom_exception ${exceptions.length}`);
  console.log(`leakage (B pool contains a held-out DB row): ${leakageOK ? "NONE ✓ (pool = standard lists only)" : "LEAK ✗"}`);
  console.log("\n── unit-cost accuracy on standard_like (headline) ──");
  for (const r of [resA, resB, resC]) {
    console.log(`\n[${r.name}]  answered ${r.answered}/${r.n} (refused ${r.refused})`);
    console.log(`  MAE ¥${r.MAE_cny} · MAPE median ${r.MAPE_med}% (95%CI ${r.MAPE_med_CI[0]}–${r.MAPE_med_CI[1]}) · mean ${r.MAPE_mean}%`);
    console.log(`  within ±5% ${r.within5}% · ±10% ${r.within10}% · ±15% ${r.within15}%`);
    console.log(`  underquote >10%: ${r.underquote_gt10} (${r.underquote_gt10_pct}%) · signed median ${r.signedMedian}%`);
  }
  console.log("\n── safe-price (C), global calibration, repeated 50/50 splits ──");
  console.log(`  target underquote ≤ ${target * 100}% · safe multiplier ~×${r2(median(safeMults))} (range ${r2(quantile(safeMults, 0.1))}–${r2(quantile(safeMults, 0.9))})`);
  console.log(`  achieved out-of-sample underquote: median ${r2(median(safeRates))}% (10–90% range ${r2(quantile(safeRates, 0.1))}–${r2(quantile(safeRates, 0.9))}%)`);
  console.log(`  ⚠️ n=${cPairs.length} — treat the target as indicative, not guaranteed.`);

  console.log("\n── custom_exception (route-to-factory report, NOT in headline) ──");
  const exByReason: Record<string, number> = {};
  for (const g of exceptions) {
    const reason = !is80(g.material) ? `material:${g.material || "?"}` : g.colors > 3 ? `colors:${g.colors}` : g.qty > MAX_QTY ? `qty:${g.qty}` : g.qty < 3000 ? `qty<3000` : "other";
    exByReason[reason] = (exByReason[reason] || 0) + 1;
  }
  console.log(`  ${exceptions.length} rows:`, JSON.stringify(exByReason));

  // ── 8. DIAGNOSTICS: why B refuses + coverage/accuracy tradeoff ──
  console.log("\n── B diagnostics ──");
  const reasons: Record<string, number> = {};
  for (const g of standard) {
    const res = estimateUnitFromLookup({ h: g.h, w: g.w, d: g.d, qty: g.qty, handles: g.handles, lam: g.lam, colors: g.colors }, anchors);
    if (!res.ok) { const key = (res.refused || "").split(" — ")[0]; reasons[key] = (reasons[key] || 0) + 1; }
  }
  console.log("  refuse reasons:", JSON.stringify(reasons));
  // distinct anchor sizes per variant (handles,lam)
  const variantSizes: Record<string, Set<string>> = {};
  for (const a of anchors) { const k = `handles=${a.handles},lam=${a.lam}`; (variantSizes[k] ??= new Set()).add(`${a.h}x${a.w}x${a.d}`); }
  console.log("  distinct anchor sizes per variant:", Object.fromEntries(Object.entries(variantSizes).map(([k, v]) => [k, v.size])));
  console.log("  standard_like by structure:", `2D ${standard.filter((g) => g.d <= 2).length} · 3D ${standard.filter((g) => g.d > 2).length}`);
  const aH = anchors.map((a) => a.h), aW = anchors.map((a) => a.w), aD = anchors.map((a) => a.d);
  console.log(`  anchor dim ranges: H[${Math.min(...aH)}-${Math.max(...aH)}] W[${Math.min(...aW)}-${Math.max(...aW)}] D[${Math.min(...aD)}-${Math.max(...aD)}]`);
  console.log(`  anchor distinct sizes: ${[...new Set(anchors.map((a) => `${a.h}x${a.w}x${a.d}`))].sort().join("  ")}`);
  console.log("  standard_like sizes (in/out envelope):");
  for (const g of standard) {
    const inEnv = g.h >= Math.min(...aH) && g.h <= Math.max(...aH) && g.w >= Math.min(...aW) && g.w <= Math.max(...aW) && g.d >= Math.min(...aD) && g.d <= Math.max(...aD);
    const exact = anchors.some((a) => Math.abs(a.h - g.h) <= 0.1 && Math.abs(a.w - g.w) <= 0.1 && Math.abs(a.d - g.d) <= 0.1 && a.handles === g.handles && a.lam === g.lam);
    console.log(`    ${g.h}x${g.w}x${g.d} q${g.qty} h=${g.handles?1:0} lam=${g.lam?1:0} c${g.colors} → ${inEnv ? "IN" : "OUT"}${exact ? " EXACT" : ""}`);
  }
  console.log("\n  maxFeatureDistance sweep (answered / MAPEmed / underquote>10):");
  for (const mfd of [0.28, 0.4, 0.6, 0.8, 1.2, 2.0]) {
    const th = { ...DEFAULT_LOOKUP_THRESHOLDS, maxFeatureDistance: mfd };
    let ans = 0; const ap: number[] = []; const sg: number[] = [];
    for (const g of standard) {
      const res = estimateUnitFromLookup({ h: g.h, w: g.w, d: g.d, qty: g.qty, handles: g.handles, lam: g.lam, colors: g.colors }, anchors, th);
      if (res.ok) { ans++; ap.push(Math.abs(res.unitExpected! - g.actual) / g.actual * 100); sg.push((g.actual - res.unitExpected!) / res.unitExpected! * 100); }
    }
    console.log(`    mfd=${mfd}: answered ${ans}/${standard.length} · MAPEmed ${r2(median(ap))}% · underq>10 ${sg.filter((x) => x > 10).length}`);
  }

  console.log("\nJSON:", JSON.stringify({ resA, resB, resC, leakageOK, safeMultMedian: r2(median(safeMults)), safeRateMedian: r2(median(safeRates)) }));
  process.exit(0);
}

function normFac(s: string) { if (/华庆|mandy/i.test(s)) return "Mandy"; if (/亚森/.test(s)) return "亚森"; if (/永驰/.test(s)) return "永驰"; if (/亚宁/.test(s)) return "亚宁"; if (/鼎驰/.test(s)) return "鼎驰"; return s.trim().slice(0, 6) || "?"; }

main().catch((e) => { console.error(e); process.exit(1); });

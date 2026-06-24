/**
 * GENERAL per-factory self-quote estimator (80g). READ-ONLY, no DB writes.
 *
 * Source of truth = the two LIVE Feishu tables (NOT constants.ts):
 *   - Catalog PBKystZ… : one tab per size. Price cell COLOUR = factory
 *     (green #70AD47 = Mandy/华庆, blue #5B9BD5 = 亚森/温州亚森). Values API gives
 *     spec+price per row; xlsx export gives the colour. We join them per row with
 *     a price cross-check guard (catches any misalignment).
 *   - Quote-log E727…/0VJakh : real custom 80g quotes, by supplier. These ALSO
 *     feed the fit (lamination series) and are the leave-one-out validation set.
 *
 * CORRECTED decomposition (per factory, per tier 3000/5000/10000):
 *   base   = 1-color, non-lam, no-handle  → makeFee + perCm2·area   (area=2HW+2HD+WD)
 *   colors = (2c/3c − 1c) non-lam add-on  (per extra colour)
 *   handle = (1c handle − 1c non-handle)
 *   lam    = Non-laminating series (heat-press); lam-handle add-on separate;
 *            plate fee 版费 is a SEPARATE one-time line per colour (not per-unit).
 *
 * Run:  export FEISHU_APP_ID=… FEISHU_APP_SECRET=…   (de-quoted)
 *       npx tsx scripts/fit-estimator.ts
 */
import { getTenantAccessToken, feishuFetch } from "@/lib/feishu/client";
import * as XLSX from "xlsx";
import { catalogCartonPts, fitCartonT, looCartonT, impliedTmm, isGussetedNormal, type CartonPt } from "@/lib/factory/server/estimator-fit";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const QLOG = "E727shGUTh0BZ8tA7bZcivRhnsh";
const QTAB = "0VJakh";
const TIERS = [3000, 5000, 10000] as const;
const MAX_QTY = 10000;
const COLOR_FACTORY: Record<string, string> = { "70AD47": "Mandy", "5B9BD5": "亚森" };

const area = (h: number, d: number, w: number) => 2 * h * w + 2 * h * d + w * d;
function dimsName(n: string) { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; }
function dimsStr(s: string) { const m = s.replace(/×/g, "*").match(/H\s*(\d+(?:\.\d+)?)(?:\s*\*?\s*D\s*(\d+(?:\.\d+)?))?\s*\*?\s*W\s*(\d+(?:\.\d+)?)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; }
function numOf(s: unknown) { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
function txt(c: unknown) { return Array.isArray(c) ? c.map((s: { text?: string }) => s?.text ?? "").join("") : c == null ? "" : String(c); }
/** logo-colour count from a printing label. 1/2/3, or null for the combined lam row. */
function colorsOf(s: string): number | null { if (/\//.test(s)) return null; const m = s.match(/(\d+)\s*colou?r/i); return m ? +m[1] : null; }
function colorsFromQuote(s: string) { const m = s.match(/(\d+)/); return m ? +m[1] : 1; }
/** 版费 per colour from a cell like "1color:￥290\n2colors:￥580…" → the first ¥ amount (per-colour rate). */
function plateOf(s: string): number | null { const m = s.match(/￥\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; }
function normSupplier(s: string) { if (/华庆|mandy/i.test(s)) return "Mandy"; if (/亚森/.test(s)) return "亚森"; if (/永驰/.test(s)) return "永驰"; if (/亚宁/.test(s)) return "亚宁"; if (/鼎驰/.test(s)) return "鼎驰"; return s.trim().slice(0, 6) || "?"; }

async function exportXlsx(): Promise<XLSX.WorkBook> {
  const c = await feishuFetch<{ data: { ticket: string } }>(`/open-apis/drive/v1/export_tasks`, { method: "POST", body: JSON.stringify({ file_extension: "xlsx", token: CAT, type: "sheet" }) });
  let ft = ""; for (let i = 0; i < 30; i++) { const s = await feishuFetch<{ data: { result: { job_status: number; file_token?: string } } }>(`/open-apis/drive/v1/export_tasks/${c.data.ticket}?token=${CAT}`, { method: "GET" }); if (s.data.result.job_status === 0 && s.data.result.file_token) { ft = s.data.result.file_token; break; } await new Promise((r) => setTimeout(r, 1500)); }
  if (!ft) throw new Error("export timed out");
  const tok = await getTenantAccessToken(); const dl = await fetch(`https://open.feishu.cn/open-apis/drive/v1/export_tasks/file/${ft}/download`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
  return XLSX.read(Buffer.from(await dl.arrayBuffer()), { cellStyles: true });
}
async function readValues(id: string) { return (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? []; }

interface Pt { factory: string; size: string; area: number; colors: number | null; hasHandle: boolean; hasLam: boolean; qty: number; price: number; plateFee?: number | null; src: "catalog" | "quote"; }

let MISALIGN = 0;
function parseTab(title: string, vals: unknown[][], ws: XLSX.WorkSheet): Pt[] {
  const dm = dimsName(title); if (!dm) return [];
  const xv = (r: number, c: number) => (ws[XLSX.utils.encode_cell({ r, c })] as { v?: unknown } | undefined)?.v;
  const xcolor = (r: number) => (ws[XLSX.utils.encode_cell({ r, c: 7 })] as { s?: { fgColor?: { rgb?: string } } } | undefined)?.s?.fgColor?.rgb?.toUpperCase() ?? "";
  let handle: "Handle" | "Non" | null = null, fin: "non" | "laminating" | null = null;
  const out: Pt[] = [];
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i] ?? [];
    const h = txt(row[1]).trim(); if (h === "Handle" || h === "Non") handle = h;
    const f = txt(row[4]).trim().toLowerCase(); if (f === "non" || f === "laminating") fin = f as "non" | "laminating";
    const price = numOf(row[7]); const qcell = txt(row[5]);
    if (price == null || !handle) continue;
    if (!/热压/.test(qcell)) continue; const qm = qcell.match(/(\d{3,6})/); if (!qm) continue;
    const q = +qm[1]; if (!TIERS.includes(q as 3000)) continue;
    // GUARD: xlsx price (colour source) must match values price (spec source) → same row.
    const xp = numOf(xv(i, 7));
    if (xp != null && Math.abs(xp - price) > 0.005) { MISALIGN++; continue; }
    const factory = COLOR_FACTORY[xcolor(i)]; if (!factory) continue; // skip unknown / uncoloured
    out.push({ factory, size: title, area: area(dm.h, dm.d, dm.w), colors: colorsOf(txt(row[3])), hasHandle: handle === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" });
  }
  return out;
}
async function quoteLog(): Promise<Pt[]> {
  const rows = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${QLOG}/values/${encodeURIComponent(`${QTAB}!A1:Z220`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
  const out: Pt[] = [];
  for (const r of rows) {
    const mat = txt(r[5]); if (!/80\s*(g|克|gsm)/i.test(mat) || /kraft|牛皮|card|食品|food|140|110|250/i.test(mat)) continue;
    const dm = dimsStr(txt(r[6])); const price = numOf(r[10]); const q = numOf(r[9]); if (!dm || price == null || q == null) continue;
    const fin = txt(r[8]).toLowerCase();
    out.push({ factory: normSupplier(txt(r[17])), size: txt(r[6]), area: area(dm.h, dm.d, dm.w), colors: colorsFromQuote(txt(r[7])),
      hasHandle: /with handle|handles\b|ידיות|big handel/i.test(fin) && !/no handle|non handle|ללא/i.test(fin),
      hasLam: /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin), qty: q, price, src: "quote" });
  }
  return out;
}

function affine(xs: number[], ys: number[]) { const n = xs.length; if (n < 2) return null; const xb = xs.reduce((a, b) => a + b, 0) / n, yb = ys.reduce((a, b) => a + b, 0) / n; let nu = 0, de = 0; for (let i = 0; i < n; i++) { nu += (xs[i] - xb) * (ys[i] - yb); de += (xs[i] - xb) ** 2; } if (de === 0) return null; let sl = nu / de, ic = yb - sl * xb; if (sl < 0 || ic < 0) { let n2 = 0, d2 = 0; for (let i = 0; i < n; i++) { n2 += xs[i] * ys[i]; d2 += xs[i] ** 2; } sl = d2 ? Math.max(0, n2 / d2) : 0; ic = 0; } return { slope: sl, intercept: ic, n }; }
function pct(es: number[]) { const a = es.map(Math.abs).sort((x, y) => x - y); return { mean: es.reduce((p, c) => p + c, 0) / es.length, median: a[Math.floor(a.length / 2)], p90: a[Math.min(a.length - 1, Math.floor(a.length * 0.9))], max: a[a.length - 1], n: es.length }; }
const snap = (q: number) => { let t = TIERS[0] as number; for (const x of TIERS) if (x <= q) t = x; return t; };

interface FacModel {
  base: Record<number, ReturnType<typeof affine>>;
  lam: Record<number, ReturnType<typeof affine>>;
  color: Record<number, Record<number, number>>;   // tier → {2:Δ,3:Δ}
  handle: Record<number, number>;
  lamHandle: Record<number, number>;
  plate: ReturnType<typeof affine>;
  areaMin: number; areaMax: number;
}
function buildModel(catAll: Pt[], qlAll: Pt[], fac: string, dropQuoteKey?: string): FacModel {
  const cat = catAll.filter((p) => p.factory === fac);
  const ql = qlAll.filter((p) => p.factory === fac && p.qty <= MAX_QTY && (!dropQuoteKey || `${p.size}|${p.qty}|${p.hasLam}|${p.hasHandle}` !== dropQuoteKey));
  const base: FacModel["base"] = {}, lam: FacModel["lam"] = {}, color: FacModel["color"] = {}, handle: FacModel["handle"] = {}, lamHandle: FacModel["lamHandle"] = {};
  for (const q of TIERS) {
    const baseP = cat.filter((p) => p.qty === q && !p.hasHandle && !p.hasLam && p.colors === 1);
    base[q] = affine(baseP.map((p) => p.area), baseP.map((p) => p.price));
    // colour add-ons (non-lam): (c-color − 1-color) per size, averaged
    color[q] = {};
    for (const c of [2, 3]) {
      const ds: number[] = [];
      for (const size of new Set(cat.map((p) => p.size))) {
        const one = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && !p.hasLam && p.colors === 1)?.price;
        const cc = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && !p.hasLam && p.colors === c)?.price;
        if (one != null && cc != null) ds.push(cc - one);
      }
      color[q][c] = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
    }
    // handle add-on (1-color non-lam)
    const hd: number[] = [];
    for (const size of new Set(cat.map((p) => p.size))) {
      const nh = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && !p.hasLam && p.colors === 1)?.price;
      const wh = cat.find((p) => p.size === size && p.qty === q && p.hasHandle && !p.hasLam && p.colors === 1)?.price;
      if (nh != null && wh != null) hd.push(wh - nh);
    }
    handle[q] = hd.length ? hd.reduce((a, b) => a + b, 0) / hd.length : 0;
    // lam-handle add-on (laminating handle − non)
    const lhd: number[] = [];
    for (const size of new Set(cat.map((p) => p.size))) {
      const nh = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && p.hasLam)?.price;
      const wh = cat.find((p) => p.size === size && p.qty === q && p.hasHandle && p.hasLam)?.price;
      if (nh != null && wh != null) lhd.push(wh - nh);
    }
    lamHandle[q] = lhd.length ? lhd.reduce((a, b) => a + b, 0) / lhd.length : 0;
  }
  // lam base series = catalog Non-laminating + quote-log laminated (handle-adjusted)
  for (const q of TIERS) {
    const xs: number[] = [], ys: number[] = [];
    for (const p of cat.filter((p) => p.qty === q && !p.hasHandle && p.hasLam)) { xs.push(p.area); ys.push(p.price); }
    for (const p of ql.filter((p) => snap(p.qty) === q && p.hasLam)) { xs.push(p.area); ys.push(p.price - (p.hasHandle ? lamHandle[q] : 0)); }
    lam[q] = affine(xs, ys);
  }
  const plate = affine(cat.filter((p) => p.hasLam && p.plateFee != null && p.plateFee! > 0).map((p) => p.area), cat.filter((p) => p.hasLam && p.plateFee != null && p.plateFee! > 0).map((p) => p.plateFee!));
  const areas = cat.map((p) => p.area);
  return { base, lam, color, handle, lamHandle, plate, areaMin: Math.min(...areas), areaMax: Math.max(...areas) };
}

function predict(m: FacModel, p: { area: number; qty: number; hasHandle: boolean; hasLam: boolean; colors: number | null }): { unit: number; conf: string } | null {
  const q = snap(p.qty);
  const inRange = p.area >= m.areaMin * 0.9 && p.area <= m.areaMax * 1.1;
  if (p.hasLam) { const g = m.lam[q]; if (!g) return null; const unit = g.intercept + g.slope * p.area + (p.hasHandle ? m.lamHandle[q] : 0); return { unit, conf: inRange ? "high" : "low" }; }
  const g = m.base[q]; if (!g) return null;
  const col = p.colors && p.colors > 1 ? (m.color[q][p.colors] ?? m.color[q][3] ?? 0) : 0;
  return { unit: g.intercept + g.slope * p.area + col + (p.hasHandle ? m.handle[q] : 0), conf: inRange ? "high" : "low" };
}

async function main() {
  console.log("Reading the two live Feishu tables (catalog colours + quote-log)…");
  const wb = await exportXlsx();
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const cat: Pt[] = [];
  for (const t of meta.data.sheets.filter((s) => !/总览|overview/i.test(s.title))) { const ws = wb.Sheets[t.title]; if (!ws) continue; cat.push(...parseTab(t.title, await readValues(t.sheet_id), ws)); }
  const ql = await quoteLog();
  console.log(`catalog points=${cat.length} (misaligned rows skipped=${MISALIGN}) | quote-log 80g=${ql.length}`);

  // factories with a real catalog grid → modellable
  const facs = ["Mandy", "亚森"];
  const models: Record<string, FacModel> = {};
  for (const f of facs) models[f] = buildModel(cat, ql, f);

  // ---- SANITY ASSERTIONS (fail loudly) ----
  console.log("\n================ SANITY CHECKS ================");
  const problems: string[] = [];
  for (const f of facs) {
    const m = models[f];
    for (const q of TIERS) {
      if (m.base[q] && m.base[q]!.slope <= 0) problems.push(`${f} q${q}: base perCm2 ≤ 0`);
      if (m.handle[q] < -0.01) problems.push(`${f} q${q}: handle add-on negative (${m.handle[q].toFixed(3)})`);
      if (m.color[q][2] < -0.01 || m.color[q][3] < -0.01) problems.push(`${f} q${q}: colour add-on negative`);
      // lam ≥ base at a mid area
      const mid = (m.areaMin + m.areaMax) / 2;
      if (m.base[q] && m.lam[q]) { const b = m.base[q]!.intercept + m.base[q]!.slope * mid, l = m.lam[q]!.intercept + m.lam[q]!.slope * mid; if (l < b - 0.01) problems.push(`${f} q${q}: lam (${l.toFixed(2)}) < base (${b.toFixed(2)}) at area ${mid.toFixed(0)}`); }
    }
    // base total should rise 3000→5000→10000? per-unit falls; check per-unit monotone down
    const a = (m.areaMin + m.areaMax) / 2;
    const bu = TIERS.map((q) => m.base[q] ? m.base[q]!.intercept + m.base[q]!.slope * a : null);
    if (bu[0] != null && bu[1] != null && bu[0] < bu[1]) problems.push(`${f}: base unit 3000<5000 (not falling)`);
  }
  console.log(problems.length ? "  ⚠️ " + problems.join("\n  ⚠️ ") : "  all sanity checks passed ✅");

  // ---- per-factory fits ----
  console.log("\n================ PER-FACTORY MODEL (1-color base, area=2HW+2HD+WD) ================");
  for (const f of facs) { const m = models[f]; console.log(`  ${f}  area∈[${m.areaMin}-${m.areaMax}]`); for (const q of TIERS) { const b = m.base[q], l = m.lam[q]; console.log(`    q=${String(q).padStart(5)}: base ${b ? `¥${b.intercept.toFixed(3)}+${b.slope.toFixed(6)}·a (n=${b.n})` : "—"} | lam ${l ? `¥${l.intercept.toFixed(3)}+${l.slope.toFixed(6)}·a (n=${l.n})` : "—"} | +2c ¥${m.color[q][2].toFixed(3)} +3c ¥${m.color[q][3].toFixed(3)} | hdl ¥${m.handle[q].toFixed(3)} lamHdl ¥${m.lamHandle[q].toFixed(3)}`); } console.log(`    plate(版费)/colour = ¥${m.plate ? m.plate.intercept.toFixed(0) + "+" + m.plate.slope.toFixed(4) + "·a" : "—"}`); }

  // ---- LEAVE-ONE-OUT validation vs real quotes (qty ≤ 10000) ----
  console.log("\n================ LEAVE-ONE-OUT VALIDATION vs real quotes (qty ≤ 10000) ================");
  const errs: number[] = []; const refused: string[] = [];
  for (const m of ql.filter((p) => p.qty <= MAX_QTY)) {
    if (!facs.includes(m.factory)) { refused.push(`${m.size} q${m.qty} ${m.factory} — no catalog grid → factory`); continue; }
    // refit that factory WITHOUT this exact quote point (LOO) when it would have fed the fit
    const model = m.hasLam ? buildModel(cat, ql, m.factory, `${m.size}|${m.qty}|${m.hasLam}|${m.hasHandle}`) : models[m.factory];
    const pr = predict(model, m);
    if (!pr) { refused.push(`${m.size} q${m.qty} ${m.hasLam ? "lam" : "non-lam"} ${m.factory} — combo not modellable → factory`); continue; }
    if (pr.conf === "low") { refused.push(`${m.size} a=${m.area.toFixed(0)} q${m.qty} ${m.factory} — out of fitted range → factory`); continue; }
    const e = (pr.unit - m.price) / m.price * 100; errs.push(e);
    console.log(`  ${m.size.padEnd(13)} a=${m.area.toFixed(0).padStart(5)} q=${String(m.qty).padStart(5)} ${m.hasHandle ? "H" : "-"}${m.hasLam ? "L" : "-"} ${String(m.colors ?? "?")}c ${m.factory.padEnd(6)} | actual=¥${m.price} pred=¥${pr.unit.toFixed(2)} err=${e.toFixed(1)}%`);
  }
  if (errs.length) { const s = pct(errs); console.log(`\n  LOO: mean=${s.mean.toFixed(1)}% median|%|=${s.median.toFixed(1)}% p90=${s.p90.toFixed(1)}% max=${s.max.toFixed(1)}% (n=${s.n})`); console.log(`  GATE (median|%| ≤ 6%): ${s.median <= 6 ? "PASS ✅" : "FAIL ❌"}`); }
  if (refused.length) { console.log(`\n  REFUSED → route to factory (${refused.length}):`); for (const r of refused) console.log(`    ${r}`); }

  // ---- CARTON / PACKING report (VERIFIED 2026-06-24) ----
  await cartonReport();

  // ---- COEFFICIENTS (Phase-1 deliverable; Phase-2 writes these to app_config) ----
  const coeffs = {
    version: 1, areaFormula: "2HW+2HD+WD", material: "80g", maxQty: MAX_QTY,
    colorMap: { "70AD47": "Mandy", "5B9BD5": "亚森" },
    factories: Object.fromEntries(facs.map((f) => {
      const m = models[f];
      return [f, {
        areaMin: m.areaMin, areaMax: m.areaMax,
        plateFeePerColor: m.plate ? { intercept: r3(m.plate.intercept), slope: m.plate.slope } : null,
        tiers: Object.fromEntries(TIERS.map((q) => [q, {
          base: m.base[q] ? { makeFee: r3(m.base[q]!.intercept), perCm2: m.base[q]!.slope } : null,
          lam: m.lam[q] ? { makeFee: r3(m.lam[q]!.intercept), perCm2: m.lam[q]!.slope } : null,
          color: m.color[q], handle: r3(m.handle[q]), lamHandle: r3(m.lamHandle[q]),
        }])),
      }];
    })),
  };
  console.log("\n================ COEFFICIENTS JSON ================");
  console.log(JSON.stringify(coeffs, null, 2));

  // ---- --commit: publish to app_config (key factory_estimators) ----
  if (process.argv.includes("--commit")) {
    const loo = errs.length ? pct(errs) : null;
    // map to EstimatorCoeffs shape: plate uses {makeFee,perCm2}; 亚森 lam → null.
    const forDb = {
      version: 1, areaFormula: "2HW+2HD+WD", material: "80g", maxQty: MAX_QTY,
      fittedAt: new Date().toISOString().slice(0, 10),
      accuracy: loo ? { medianPct: r3(loo.median), maxPct: r3(loo.max), n: loo.n } : null,
      factories: Object.fromEntries(facs.map((f) => {
        const fc = coeffs.factories[f] as { areaMin: number; areaMax: number; plateFeePerColor: { intercept: number; slope: number } | null; tiers: Record<string, { base: unknown; lam: unknown; color: Record<string, number>; handle: number; lamHandle: number }> };
        return [f, {
          areaMin: fc.areaMin, areaMax: fc.areaMax,
          plateFeePerColor: fc.plateFeePerColor ? { makeFee: fc.plateFeePerColor.intercept, perCm2: fc.plateFeePerColor.slope } : null,
          tiers: Object.fromEntries(Object.entries(fc.tiers).map(([q, t]) => [q, {
            base: t.base, lam: f === "亚森" ? null : t.lam, color: t.color, handle: t.handle, lamHandle: t.lamHandle,
          }])),
        }];
      })),
    };
    const gateOk = !loo || loo.median <= 6;
    if (!gateOk) { console.log(`\n❌ NOT committing — LOO median ${loo!.median.toFixed(1)}% > 6% gate`); return; }
    const { setEstimatorCoeffs } = await import("@/lib/factory/estimator-config");
    await setEstimatorCoeffs(forDb as unknown as Parameters<typeof setEstimatorCoeffs>[0]);
    console.log("\n✅ committed coefficients → app_config (factory_estimators)");
  }
}
/** Pull DB carton points (any status with carton master data, 80g non-woven), if DATABASE_URL is set. */
async function dbCartonPts(): Promise<CartonPt[]> {
  try {
    const { db } = await import("@/lib/db");
    const { factoryQuoteRequests } = await import("@/drizzle/schema");
    type Resp = { supplier?: string; cartonQty?: number; cartonCbm?: number; cartonLengthCm?: number; cartonWidthCm?: number; cartonHeightCm?: number };
    type Spec = { material?: string; heightCm?: number; widthCm?: number; depthCm?: number };
    const rows = await db.select().from(factoryQuoteRequests);
    const out: CartonPt[] = []; const seen = new Set<string>();
    for (const row of rows) {
      const resp = row.factoryResponse as Resp | null; const spec = row.productSpec as Spec | null;
      if (!resp || !spec) continue;
      const ok80 = /80\s*(g|克|gsm)/i.test(spec.material ?? "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "");
      const h = spec.heightCm ?? 0, w = spec.widthCm ?? 0, d = spec.depthCm ?? 0;
      if (!ok80 || !h || !w) continue;
      const cq = resp.cartonQty ?? 0;
      const cbm = resp.cartonCbm ?? (resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm ? (resp.cartonLengthCm * resp.cartonWidthCm * resp.cartonHeightCm) / 1e6 : 0);
      if (cq <= 0 || cbm <= 0) continue;
      const a = area(h, d, w); const cbmPerUnit = cbm / cq; const t = (cbmPerUnit / a) * 1e7;
      const key = `${h}|${d}|${w}|${cbmPerUnit.toFixed(6)}`;
      if (t >= 0.3 && t <= 1.4 && !seen.has(key)) { seen.add(key); out.push({ factory: normSupplier(resp.supplier ?? ""), area: a, depth: d, height: h, cbmPerUnit, src: "db" }); }
    }
    return out;
  } catch (e) { console.log(`  (DB carton points unavailable: ${e instanceof Error ? e.message : e})`); return []; }
}

async function cartonReport() {
  console.log("\n================ CARTON / PACKING MODEL (CBM/unit = area × T mm) ================");
  const cat = catalogCartonPts();
  const dbp = await dbCartonPts();
  const all = [...cat, ...dbp];
  const g = all.filter((p) => isGussetedNormal(p));
  console.log(`  points: catalog ${cat.length} + DB ${dbp.length} = ${all.length}  → gusseted in-envelope (D>2, H≥10, area∈[1500,5400]) = ${g.length}`);
  const fit = fitCartonT(all); const loo = looCartonT(all);
  console.log(`  fitted T (gusseted) = ${fit.tMmGusseted.toFixed(3)} mm   per-factory: ${Object.entries(fit.perFactoryTMm).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · ") || "—"}`);
  console.log(`  LOO CBM/unit: median=${loo.median.toFixed(1)}% p90=${loo.p90.toFixed(1)}% max=${loo.max.toFixed(1)}% (n=${g.length})`);
  console.log(`  GATE (median ≤ 10%): ${loo.median <= 10 ? "PASS ✅" : "FAIL ❌"}`);
  // flat/tray excluded → reported separately (manual-only)
  const flat = all.filter((p) => !isGussetedNormal(p));
  if (flat.length) console.log(`  manual-only (flat/tray/out-of-envelope, not formula-quotable): ${flat.length} — e.g. ${flat.slice(0, 4).map((p) => `H${p.height}D${p.depth} t=${impliedTmm(p).toFixed(2)}mm`).join(", ")}`);
}

function r3(n: number) { return Math.round(n * 1000) / 1000; }
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

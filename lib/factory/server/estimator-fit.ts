/**
 * Shared fitting core for the self-quote estimator. Used by BOTH:
 *   - scripts/fit-estimator.ts  (offline generator / report / --commit)
 *   - lib/factory/server/refit-estimator.ts  (daily auto-refit cron)
 *
 * Reads the two live Feishu tables (catalog colours = factories + the custom
 * quote-log), fits a per-factory affine area model per qty tier (1-color base +
 * colour/handle/lamination add-ons), and produces EstimatorCoeffs. Extra data
 * points (e.g. new factory_quote_requests) can be merged into the quote-log set.
 *
 * NOTE: imports the Feishu client only (no DB) — DB feed + publish live in the
 * caller (refit-estimator.ts / the script's --commit path).
 */
import { getTenantAccessToken, feishuFetch } from "@/lib/feishu/client";
import * as XLSX from "xlsx";
import type { EstimatorCoeffs, CartonCoef } from "@/lib/factory/estimator-config";
import { DEFAULT_CARTON_COEF } from "@/lib/factory/estimator-config";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const QLOG = "E727shGUTh0BZ8tA7bZcivRhnsh";
const QTAB = "0VJakh";
export const TIERS = [3000, 5000, 10000] as const;
export const MAX_QTY = 10000;
export const FACS = ["Mandy", "亚森"] as const;
const COLOR_FACTORY: Record<string, string> = { "70AD47": "Mandy", "5B9BD5": "亚森" };

export const bagAreaCm2 = (h: number, d: number, w: number) => 2 * h * w + 2 * h * d + w * d;
function dimsName(n: string) { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; }
export function dimsStr(s: string) { const m = s.replace(/×/g, "*").match(/H\s*(\d+(?:\.\d+)?)(?:\s*\*?\s*D\s*(\d+(?:\.\d+)?))?\s*\*?\s*W\s*(\d+(?:\.\d+)?)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; }
function numOf(s: unknown) { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
function txt(c: unknown) { return Array.isArray(c) ? c.map((s: { text?: string }) => s?.text ?? "").join("") : c == null ? "" : String(c); }
function colorsOf(s: string): number | null { if (/\//.test(s)) return null; const m = s.match(/(\d+)\s*colou?r/i); return m ? +m[1] : null; }
export function colorsFromText(s: string) { const m = s.match(/(\d+)/); return m ? +m[1] : 1; }
export function normSupplier(s: string) { if (/华庆|mandy/i.test(s)) return "Mandy"; if (/亚森/.test(s)) return "亚森"; if (/永驰/.test(s)) return "永驰"; if (/亚宁/.test(s)) return "亚宁"; if (/鼎驰/.test(s)) return "鼎驰"; return s.trim().slice(0, 6) || "?"; }

export interface Pt { factory: string; size: string; area: number; colors: number | null; hasHandle: boolean; hasLam: boolean; qty: number; price: number; plateFee?: number | null; src: "catalog" | "quote" | "db" }

async function exportXlsx(): Promise<XLSX.WorkBook> {
  const c = await feishuFetch<{ data: { ticket: string } }>(`/open-apis/drive/v1/export_tasks`, { method: "POST", body: JSON.stringify({ file_extension: "xlsx", token: CAT, type: "sheet" }) });
  let ft = ""; for (let i = 0; i < 30; i++) { const s = await feishuFetch<{ data: { result: { job_status: number; file_token?: string } } }>(`/open-apis/drive/v1/export_tasks/${c.data.ticket}?token=${CAT}`, { method: "GET" }); if (s.data.result.job_status === 0 && s.data.result.file_token) { ft = s.data.result.file_token; break; } await new Promise((r) => setTimeout(r, 1500)); }
  if (!ft) throw new Error("feishu export timed out");
  const tok = await getTenantAccessToken(); const dl = await fetch(`https://open.feishu.cn/open-apis/drive/v1/export_tasks/file/${ft}/download`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!dl.ok) throw new Error(`feishu download HTTP ${dl.status}`);
  return XLSX.read(Buffer.from(await dl.arrayBuffer()), { cellStyles: true });
}
async function readValues(id: string) { return (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? []; }

function parseTab(title: string, vals: unknown[][], ws: XLSX.WorkSheet, onMisalign: () => void): Pt[] {
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
    const q = +qm[1]; if (!(TIERS as readonly number[]).includes(q)) continue;
    const xp = numOf(xv(i, 7));
    if (xp != null && Math.abs(xp - price) > 0.005) { onMisalign(); continue; }
    const factory = COLOR_FACTORY[xcolor(i)]; if (!factory) continue;
    out.push({ factory, size: title, area: bagAreaCm2(dm.h, dm.d, dm.w), colors: colorsOf(txt(row[3])), hasHandle: handle === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" });
  }
  return out;
}
function plateOf(s: string): number | null { const m = s.match(/￥\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; }

async function quoteLogPoints(): Promise<Pt[]> {
  const rows = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${QLOG}/values/${encodeURIComponent(`${QTAB}!A1:Z220`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
  const out: Pt[] = [];
  for (const r of rows) {
    const mat = txt(r[5]); if (!/80\s*(g|克|gsm)/i.test(mat) || /kraft|牛皮|card|食品|food|140|110|250/i.test(mat)) continue;
    const dm = dimsStr(txt(r[6])); const price = numOf(r[10]); const q = numOf(r[9]); if (!dm || price == null || q == null) continue;
    const fin = txt(r[8]).toLowerCase();
    out.push({ factory: normSupplier(txt(r[17])), size: txt(r[6]), area: bagAreaCm2(dm.h, dm.d, dm.w), colors: colorsFromText(txt(r[7])),
      hasHandle: /with handle|handles\b|ידיות|big handel/i.test(fin) && !/no handle|non handle|ללא/i.test(fin),
      hasLam: /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin), qty: q, price, src: "quote" });
  }
  return out;
}

export async function extractFeishu(): Promise<{ cat: Pt[]; ql: Pt[]; misaligned: number }> {
  const wb = await exportXlsx();
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  let misaligned = 0;
  const cat: Pt[] = [];
  for (const t of meta.data.sheets.filter((s) => !/总览|overview/i.test(s.title))) { const ws = wb.Sheets[t.title]; if (!ws) continue; cat.push(...parseTab(t.title, await readValues(t.sheet_id), ws, () => misaligned++)); }
  const ql = await quoteLogPoints();
  return { cat, ql, misaligned };
}

function affine(xs: number[], ys: number[]) { const n = xs.length; if (n < 2) return null; const xb = xs.reduce((a, b) => a + b, 0) / n, yb = ys.reduce((a, b) => a + b, 0) / n; let nu = 0, de = 0; for (let i = 0; i < n; i++) { nu += (xs[i] - xb) * (ys[i] - yb); de += (xs[i] - xb) ** 2; } if (de === 0) return null; let sl = nu / de, ic = yb - sl * xb; if (sl < 0 || ic < 0) { let n2 = 0, d2 = 0; for (let i = 0; i < n; i++) { n2 += xs[i] * ys[i]; d2 += xs[i] ** 2; } sl = d2 ? Math.max(0, n2 / d2) : 0; ic = 0; } return { slope: sl, intercept: ic, n }; }
export function pct(es: number[]) { const a = es.map(Math.abs).sort((x, y) => x - y); return { mean: es.reduce((p, c) => p + c, 0) / es.length, median: a[Math.floor(a.length / 2)], p90: a[Math.min(a.length - 1, Math.floor(a.length * 0.9))], max: a[a.length - 1], n: es.length }; }
export const snapTier = (q: number) => { let t = TIERS[0] as number; for (const x of TIERS) if (x <= q) t = x; return t; };

export interface FacModel {
  base: Record<number, ReturnType<typeof affine>>; lam: Record<number, ReturnType<typeof affine>>;
  color: Record<number, Record<number, number>>; handle: Record<number, number>; lamHandle: Record<number, number>;
  plate: ReturnType<typeof affine>; areaMin: number; areaMax: number;
}
export function buildModel(catAll: Pt[], qlAll: Pt[], fac: string, dropQuoteKey?: string): FacModel {
  const cat = catAll.filter((p) => p.factory === fac);
  const ql = qlAll.filter((p) => p.factory === fac && p.qty <= MAX_QTY && (!dropQuoteKey || `${p.size}|${p.qty}|${p.hasLam}|${p.hasHandle}` !== dropQuoteKey));
  const base: FacModel["base"] = {}, lam: FacModel["lam"] = {}, color: FacModel["color"] = {}, handle: FacModel["handle"] = {}, lamHandle: FacModel["lamHandle"] = {};
  for (const q of TIERS) {
    const baseP = cat.filter((p) => p.qty === q && !p.hasHandle && !p.hasLam && p.colors === 1);
    base[q] = affine(baseP.map((p) => p.area), baseP.map((p) => p.price));
    color[q] = {};
    for (const cc of [2, 3]) {
      const ds: number[] = [];
      for (const size of new Set(cat.map((p) => p.size))) {
        const one = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && !p.hasLam && p.colors === 1)?.price;
        const cv = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && !p.hasLam && p.colors === cc)?.price;
        if (one != null && cv != null) ds.push(cv - one);
      }
      color[q][cc] = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0;
    }
    const hd: number[] = [];
    for (const size of new Set(cat.map((p) => p.size))) {
      const nh = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && !p.hasLam && p.colors === 1)?.price;
      const wh = cat.find((p) => p.size === size && p.qty === q && p.hasHandle && !p.hasLam && p.colors === 1)?.price;
      if (nh != null && wh != null) hd.push(wh - nh);
    }
    handle[q] = hd.length ? hd.reduce((a, b) => a + b, 0) / hd.length : 0;
    const lhd: number[] = [];
    for (const size of new Set(cat.map((p) => p.size))) {
      const nh = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && p.hasLam)?.price;
      const wh = cat.find((p) => p.size === size && p.qty === q && p.hasHandle && p.hasLam)?.price;
      if (nh != null && wh != null) lhd.push(wh - nh);
    }
    lamHandle[q] = lhd.length ? lhd.reduce((a, b) => a + b, 0) / lhd.length : 0;
  }
  for (const q of TIERS) {
    const xs: number[] = [], ys: number[] = [];
    for (const p of cat.filter((p) => p.qty === q && !p.hasHandle && p.hasLam)) { xs.push(p.area); ys.push(p.price); }
    for (const p of ql.filter((p) => snapTier(p.qty) === q && p.hasLam)) { xs.push(p.area); ys.push(p.price - (p.hasHandle ? lamHandle[q] : 0)); }
    lam[q] = affine(xs, ys);
  }
  const plateP = cat.filter((p) => p.hasLam && p.plateFee != null && p.plateFee! > 0);
  const plate = affine(plateP.map((p) => p.area), plateP.map((p) => p.plateFee!));
  const areas = cat.map((p) => p.area);
  return { base, lam, color, handle, lamHandle, plate, areaMin: areas.length ? Math.min(...areas) : 0, areaMax: areas.length ? Math.max(...areas) : 0 };
}

export function predict(m: FacModel, p: { area: number; qty: number; hasHandle: boolean; hasLam: boolean; colors: number | null }): { unit: number; conf: "high" | "low" } | null {
  const q = snapTier(p.qty);
  const inRange = p.area >= m.areaMin * 0.9 && p.area <= m.areaMax * 1.1;
  if (p.hasLam) { const g = m.lam[q]; if (!g) return null; return { unit: g.intercept + g.slope * p.area + (p.hasHandle ? m.lamHandle[q] : 0), conf: inRange ? "high" : "low" }; }
  const g = m.base[q]; if (!g) return null;
  const col = p.colors && p.colors > 1 ? (m.color[q][p.colors] ?? m.color[q][3] ?? 0) : 0;
  return { unit: g.intercept + g.slope * p.area + col + (p.hasHandle ? m.handle[q] : 0), conf: inRange ? "high" : "low" };
}

export interface LooResult { errs: number[]; refused: string[]; stats: ReturnType<typeof pct> | null }
export function looValidate(cat: Pt[], ql: Pt[]): LooResult {
  const errs: number[] = []; const refused: string[] = [];
  const baseModels: Record<string, FacModel> = {}; for (const f of FACS) baseModels[f] = buildModel(cat, ql, f);
  for (const m of ql.filter((p) => p.qty <= MAX_QTY)) {
    if (!(FACS as readonly string[]).includes(m.factory)) { refused.push(`${m.size} ${m.factory} (no grid)`); continue; }
    const model = m.hasLam ? buildModel(cat, ql, m.factory, `${m.size}|${m.qty}|${m.hasLam}|${m.hasHandle}`) : baseModels[m.factory];
    const pr = predict(model, m);
    if (!pr) { refused.push(`${m.size} ${m.factory} (combo)`); continue; }
    if (pr.conf === "low") { refused.push(`${m.size} ${m.factory} (range)`); continue; }
    errs.push((pr.unit - m.price) / m.price * 100);
  }
  return { errs, refused, stats: errs.length ? pct(errs) : null };
}

/* ───────────────────────── Carton / packing model ─────────────────────────
 * VERIFIED 2026-06-24 (workflow wf_699152fc-834). A flat-stacked folded bag occupies
 * `area × T`, so CBM/unit (m³) = T_mm · area · 1e-7. T fitted on GUSSETED 80g bags only
 * (D>2, H≥10, area in envelope) — flat/tray geometries are not formula-quotable. The
 * carton's discrete standard-box choice cancels out of CBM/unit (bigger box ⇒ more pcs). */
export interface CartonPt { factory: string; area: number; depth: number; height: number; cbmPerUnit: number; src: "catalog" | "db" }
const GUSSET_MIN = 2, TRAY_H_MIN = 10;
export const impliedTmm = (p: CartonPt) => (p.cbmPerUnit / p.area) * 1e7; // m³/cm² → mm stacked thickness
export function isGussetedNormal(p: { depth: number; height: number; area: number }, areaMin = DEFAULT_CARTON_COEF.areaMin, areaMax = DEFAULT_CARTON_COEF.areaMax) {
  return p.depth > GUSSET_MIN && p.height >= TRAY_H_MIN && p.area >= areaMin && p.area <= areaMax;
}

/** Catalog packing (constants.ts) → carton points. The dense clean backbone. */
export function catalogCartonPts(): CartonPt[] {
  const out: CartonPt[] = [];
  for (const p of DEFAULT_CONFIG.products) {
    const m = p.dimensions.replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i); if (!m) continue;
    const h = +m[1], d = m[2] ? +m[2] : 0, w = +m[3]; const area = bagAreaCm2(h, d, w);
    for (const v of [p.withHandles, p.withoutHandles]) {
      const c = v.carton; if (!c?.qty) continue;
      out.push({ factory: "catalog", area, depth: d, height: h, cbmPerUnit: (c.length * c.width * c.height / 1e6) / c.qty, src: "catalog" });
    }
  }
  return out;
}

const median = (xs: number[]) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

/** Fit T (gusseted only) + per-factory T, from catalog + DB carton points. */
export function fitCartonT(pts: CartonPt[]): { tMmGusseted: number; perFactoryTMm: Record<string, number>; areaMin: number; areaMax: number; n: number } {
  const g = pts.filter((p) => isGussetedNormal(p));
  const tMmGusseted = g.length ? Math.round(median(g.map(impliedTmm)) * 1000) / 1000 : DEFAULT_CARTON_COEF.tMmGusseted;
  const perFactoryTMm: Record<string, number> = {};
  for (const f of new Set(g.map((p) => p.factory))) {
    if (f === "catalog") continue;
    const fts = g.filter((p) => p.factory === f).map(impliedTmm);
    if (fts.length >= 3) perFactoryTMm[f] = Math.round(median(fts) * 1000) / 1000;
  }
  const areas = g.map((p) => p.area);
  return { tMmGusseted, perFactoryTMm, areaMin: areas.length ? Math.min(...areas) : DEFAULT_CARTON_COEF.areaMin, areaMax: areas.length ? Math.max(...areas) : DEFAULT_CARTON_COEF.areaMax, n: g.length };
}

/** Strict leave-one-out for CBM/unit = area×T on the gusseted scope. */
export function looCartonT(pts: CartonPt[]): ReturnType<typeof pct> {
  const g = pts.filter((p) => isGussetedNormal(p));
  const errs: number[] = [];
  for (let i = 0; i < g.length; i++) {
    const others = g.filter((_, j) => j !== i).map(impliedTmm);
    if (!others.length) continue;
    const T = median(others);
    const pred = T * g[i].area * 1e-7;
    errs.push((pred - g[i].cbmPerUnit) / g[i].cbmPerUnit * 100);
  }
  return pct(errs.length ? errs : [0]);
}

/** Build the publishable CartonCoef, keeping the verified defaults for the discrete-carton knobs. */
export function toCartonCoef(pts: CartonPt[], fittedAt: string): CartonCoef {
  const f = fitCartonT(pts); const loo = looCartonT(pts);
  return {
    ...DEFAULT_CARTON_COEF,
    tMmGusseted: f.tMmGusseted, perFactoryTMm: { ...DEFAULT_CARTON_COEF.perFactoryTMm, ...f.perFactoryTMm },
    areaMin: Math.min(f.areaMin, DEFAULT_CARTON_COEF.areaMin), areaMax: Math.max(f.areaMax, DEFAULT_CARTON_COEF.areaMax),
    accuracy: { medianPct: Math.round(loo.median * 10) / 10, maxPct: Math.round(loo.max * 10) / 10, n: f.n }, fittedAt,
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export function toCoeffs(cat: Pt[], ql: Pt[], loo: LooResult, fittedAt: string, carton?: CartonCoef): EstimatorCoeffs {
  const factories: EstimatorCoeffs["factories"] = {};
  for (const f of FACS) {
    const m = buildModel(cat, ql, f);
    factories[f] = {
      areaMin: m.areaMin, areaMax: m.areaMax,
      plateFeePerColor: m.plate ? { makeFee: r3(m.plate.intercept), perCm2: m.plate.slope } : null,
      tiers: Object.fromEntries(TIERS.map((q) => [String(q), {
        base: m.base[q] ? { makeFee: r3(m.base[q]!.intercept), perCm2: m.base[q]!.slope } : null,
        // lamination ⇒ Mandy only (亚森 laminates by sewing → route to factory).
        lam: f === "亚森" ? null : (m.lam[q] ? { makeFee: r3(m.lam[q]!.intercept), perCm2: m.lam[q]!.slope } : null),
        color: { "2": r3(m.color[q][2] ?? 0), "3": r3(m.color[q][3] ?? 0) },
        handle: r3(m.handle[q]), lamHandle: r3(m.lamHandle[q]),
      }])),
    };
  }
  return {
    version: 1, areaFormula: "2HW+2HD+WD", material: "80g", maxQty: MAX_QTY, fittedAt,
    accuracy: loo.stats ? { medianPct: r3(loo.stats.median), maxPct: r3(loo.stats.max), n: loo.stats.n } : null,
    factories,
    carton: carton ?? DEFAULT_CARTON_COEF,
  };
}

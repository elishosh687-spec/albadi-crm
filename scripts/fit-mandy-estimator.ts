/**
 * Phase 1 — MANDY-ONLY self-quote estimator: extract Mandy's prices DIRECTLY from
 * the catalog (green cells = 浙江华庆塑业-Mandy; blue = 温州亚森) across all size
 * tabs, fit an affine area model per quantity tier, and validate against Mandy's
 * real custom quotes from the quote-log. READ-ONLY, no DB writes.
 *
 * Mandy is identified by cell FILL COLOR #70AD47 (green) — read by exporting the
 * Feishu catalog to xlsx (the values API does not expose colors).
 *
 * Run:
 *   export FEISHU_APP_ID=... FEISHU_APP_SECRET=...   (de-quoted)
 *   npx tsx scripts/fit-mandy-estimator.ts
 */
import { getTenantAccessToken, feishuFetch } from "@/lib/feishu/client";
import * as XLSX from "xlsx";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const QLOG = "E727shGUTh0BZ8tA7bZcivRhnsh";
const QTAB = "0VJakh";
const MANDY_GREEN = "70AD47";
const TIERS = [3000, 5000, 10000] as const;

const area = (h: number, d: number, w: number) => 2 * h * w + 2 * h * d + w * d;
function dimsFromName(n: string): { h: number; d: number; w: number } | null {
  const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i);
  return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null;
}
function dimsFromStr(s: string): { h: number; d: number; w: number } | null {
  const m = s.replace(/×/g, "*").match(/H\s*(\d+(?:\.\d+)?)(?:\s*\*?\s*D\s*(\d+(?:\.\d+)?))?\s*\*?\s*W\s*(\d+(?:\.\d+)?)/i);
  return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null;
}
function numOf(s: unknown): number | null {
  if (s == null) return null;
  const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// ---------- export the whole catalog to xlsx (one task, all tabs) ----------
async function exportCatalogXlsx(): Promise<XLSX.WorkBook> {
  const create = await feishuFetch<{ data: { ticket: string } }>(
    `/open-apis/drive/v1/export_tasks`,
    { method: "POST", body: JSON.stringify({ file_extension: "xlsx", token: CAT, type: "sheet" }) }
  );
  const ticket = create.data.ticket;
  let fileToken = "";
  for (let i = 0; i < 30; i++) {
    const st = await feishuFetch<{ data: { result: { job_status: number; job_error_msg?: string; file_token?: string } } }>(
      `/open-apis/drive/v1/export_tasks/${ticket}?token=${CAT}`, { method: "GET" });
    const r = st.data.result;
    if (r.job_status === 0 && r.file_token) { fileToken = r.file_token; break; }
    if (![0, 1, 2].includes(r.job_status)) throw new Error(`export failed ${r.job_status} ${r.job_error_msg}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  if (!fileToken) throw new Error("export timed out");
  const tok = await getTenantAccessToken();
  const dl = await fetch(`https://open.feishu.cn/open-apis/drive/v1/export_tasks/file/${fileToken}/download`, {
    headers: { Authorization: `Bearer ${tok}` } });
  if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
  return XLSX.read(Buffer.from(await dl.arrayBuffer()), { cellStyles: true });
}

interface CatPoint { size: string; h: number; d: number; w: number; area: number;
  hasHandle: boolean; hasLam: boolean; qty: number; priceCny: number; plateFee: number | null; }

function fillRgb(cell: { s?: { fgColor?: { rgb?: string }; bgColor?: { rgb?: string } } } | undefined): string | null {
  const s = cell?.s; if (!s) return null;
  return (s.fgColor?.rgb ?? s.bgColor?.rgb ?? null);
}

/** Read a tab's values via the API (keeps per-row qty labels the xlsx merges away). */
async function readValues(sheetId: string): Promise<unknown[][]> {
  const resp = await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(
    `/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${sheetId}!A1:Z120`)}`, { method: "GET" });
  return resp.data?.valueRange?.values ?? [];
}

/**
 * Join values (spec + price, per row) with xlsx colors (supplier, per row) by
 * row index → Mandy (green) heat-press points. valsRows[i] ↔ xlsx row i.
 */
function parseTab(title: string, vals: unknown[][], ws: XLSX.WorkSheet): CatPoint[] {
  const dm = dimsFromName(title);
  if (!dm) return [];
  const colorAt = (r: number) => fillRgb(ws[XLSX.utils.encode_cell({ r, c: 7 })] as never);
  const cellTxt = (row: unknown[], c: number) => { const v = row?.[c]; return Array.isArray(v) ? v.map((s: { text?: string }) => s?.text ?? "").join("") : v == null ? "" : String(v); };
  let curHandle: "Handle" | "Non" | null = null;
  let curFin: "non" | "laminating" | null = null;
  const out: CatPoint[] = [];
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i] ?? [];
    const h = cellTxt(row, 1).trim();
    if (h === "Handle" || h === "Non") curHandle = h;
    const fin = cellTxt(row, 4).trim().toLowerCase();
    if (fin === "non" || fin === "laminating") curFin = fin as "non" | "laminating";
    const qcell = cellTxt(row, 5);
    const price = numOf(row[7]);
    if (price == null || !curHandle) continue;
    const method = /热压/.test(qcell) ? "heat" : /车缝/.test(qcell) ? "sew" : null;
    const qty = (qcell.match(/(\d{3,6})/) || [])[1];
    if (method !== "heat" || !qty) continue;
    const q = parseInt(qty, 10);
    if (!TIERS.includes(q as 3000)) continue;
    if (colorAt(i)?.toUpperCase() !== MANDY_GREEN) continue; // Mandy only
    out.push({ size: title, h: dm.h, d: dm.d, w: dm.w, area: area(dm.h, dm.d, dm.w),
      hasHandle: curHandle === "Handle", hasLam: curFin === "laminating", qty: q, priceCny: price, plateFee: numOf(cellTxt(row, 6)) });
  }
  return out;
}

// ---------- least squares ----------
function affine(xs: number[], ys: number[]) {
  const n = xs.length, xb = xs.reduce((a, b) => a + b, 0) / n, yb = ys.reduce((a, b) => a + b, 0) / n;
  let nu = 0, de = 0; for (let i = 0; i < n; i++) { nu += (xs[i] - xb) * (ys[i] - yb); de += (xs[i] - xb) ** 2; }
  const slope = de === 0 ? 0 : nu / de; return { slope, intercept: yb - slope * xb };
}
function fitGroup(pts: CatPoint[]) {
  if (pts.length < 2) return null;
  const a = affine(pts.map((p) => p.area), pts.map((p) => p.priceCny));
  if (a.intercept < 0 || a.slope < 0) { // origin fallback
    let nu = 0, de = 0; for (const p of pts) { nu += p.area * p.priceCny; de += p.area ** 2; }
    return { makeFee: 0, perCm2: de ? Math.max(0, nu / de) : 0, mode: "origin", n: pts.length };
  }
  return { makeFee: a.intercept, perCm2: a.slope, mode: "affine", n: pts.length };
}
function pctStats(errs: number[]) {
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  return { mean: errs.reduce((a, b) => a + b, 0) / errs.length, median: abs[Math.floor(abs.length / 2)],
    p90: abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))], max: abs[abs.length - 1], n: errs.length };
}

// ---------- quote-log Mandy 80g points (validation) ----------
function cell(c: unknown): string { return Array.isArray(c) ? c.map((s: { text?: string }) => s?.text ?? "").join("") : c == null ? "" : String(c); }
async function readQuoteLogMandy() {
  const resp = await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(
    `/open-apis/sheets/v2/spreadsheets/${QLOG}/values/${encodeURIComponent(`${QTAB}!A1:Z220`)}`, { method: "GET" });
  const rows = resp.data?.valueRange?.values ?? [];
  const pts: { quoteNo: string; dims: string; area: number; qty: number; hasHandles: boolean; hasLam: boolean; colors: number; unit: number }[] = [];
  for (const r of rows) {
    if (!/华庆|mandy/i.test(cell(r[17]))) continue;
    const mat = cell(r[5]); if (!/80\s*(g|克|gsm)/i.test(mat) || /kraft|牛皮|card|食品|food|140|110|250/i.test(mat)) continue;
    const dm = dimsFromStr(cell(r[6])); const unit = numOf(cell(r[10])); const qty = numOf(cell(r[9]));
    if (!dm || unit == null || qty == null) continue;
    const fin = cell(r[8]).toLowerCase();
    pts.push({ quoteNo: cell(r[1]), dims: cell(r[6]), area: area(dm.h, dm.d, dm.w), qty,
      hasHandles: /with handle|handles\b|ידיות|big handel/i.test(fin) && !/no handle|non handle|ללא/i.test(fin),
      hasLam: /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin), colors: numOf(cell(r[7])) ?? 1, unit });
  }
  return pts;
}

function snapTier(q: number): number { let t = TIERS[0] as number; for (const x of TIERS) if (x <= q) t = x; return t; }

async function main() {
  console.log("Exporting catalog to xlsx (reading green=Mandy fills)…");
  const wb = await exportCatalogXlsx();
  // map sheet_id → title (values API uses id; xlsx uses title)
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(
    `/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const tabs = (meta.data?.sheets ?? []).filter((s) => !/总览|overview/i.test(s.title));
  const all: CatPoint[] = [];
  for (const t of tabs) {
    const ws = wb.Sheets[t.title];
    if (!ws) continue;
    const vals = await readValues(t.sheet_id);
    all.push(...parseTab(t.title, vals, ws));
  }
  console.log(`\n================ MANDY (green) CATALOG POINTS: ${all.length} ================`);
  const bySize: Record<string, CatPoint[]> = {};
  for (const p of all) (bySize[p.size] ??= []).push(p);
  for (const [size, pts] of Object.entries(bySize)) {
    const dm = pts[0];
    const tag = (h: boolean, l: boolean) => TIERS.map((q) => { const x = pts.find((p) => p.hasHandle === h && p.hasLam === l && p.qty === q); return x ? x.priceCny : "—"; }).join("/");
    console.log(`  ${size.padEnd(16)} area=${dm.area.toFixed(0).padStart(5)} | base(N) ${tag(false, false)} | hdl ${tag(true, false)} | lamN ${tag(false, true)} | lamH ${tag(true, true)}  (3k/5k/10k)`);
  }

  // Fit per tier on Mandy-only points
  console.log("\n================ MANDY-ONLY FIT (per tier) ================");
  const fits: Record<number, { base: ReturnType<typeof fitGroup>; lam: ReturnType<typeof fitGroup>; handleAddon: number }> = {};
  for (const q of TIERS) {
    const baseN = all.filter((p) => p.qty === q && !p.hasHandle && !p.hasLam);
    const lamN = all.filter((p) => p.qty === q && !p.hasHandle && p.hasLam);
    // handle add-on: mean(handle - non) for same size/lam/qty
    const deltas: number[] = [];
    for (const p of all.filter((p) => p.qty === q && p.hasHandle)) {
      const m = all.find((x) => x.size === p.size && x.qty === q && !x.hasHandle && x.hasLam === p.hasLam);
      if (m) deltas.push(p.priceCny - m.priceCny);
    }
    const base = fitGroup(baseN), lam = fitGroup(lamN);
    const handleAddon = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    fits[q] = { base, lam, handleAddon };
    console.log(`  q=${q}: base n=${baseN.length} ${base ? `¥${base.makeFee.toFixed(3)}+${base.perCm2.toFixed(6)}·a [${base.mode}]` : "—"}`);
    console.log(`          lam  n=${lamN.length} ${lam ? `¥${lam.makeFee.toFixed(3)}+${lam.perCm2.toFixed(6)}·a [${lam.mode}]` : "—"}   handleAddon=¥${handleAddon.toFixed(3)} (n=${deltas.length})`);
  }

  const predict = (s: { area: number; qty: number; hasHandles: boolean; hasLam: boolean }) => {
    const f = fits[snapTier(s.qty)]; const g = s.hasLam ? f.lam : f.base; if (!g) return null;
    return g.makeFee + g.perCm2 * s.area + (s.hasHandles ? f.handleAddon : 0);
  };

  // In-sample backtest on Mandy catalog points
  const inErr: number[] = [];
  for (const p of all) { const pr = predict({ area: p.area, qty: p.qty, hasHandles: p.hasHandle, hasLam: p.hasLam }); if (pr != null) inErr.push((pr - p.priceCny) / p.priceCny * 100); }
  const inS = pctStats(inErr);
  console.log(`\n  IN-SAMPLE (Mandy catalog): mean=${inS.mean.toFixed(1)}% median|%|=${inS.median.toFixed(1)}% p90=${inS.p90.toFixed(1)}% max=${inS.max.toFixed(1)}% (n=${inS.n})`);

  // Validate vs real Mandy quote-log
  console.log("\n================ VALIDATION vs Mandy quote-log (80g) ================");
  const mandy = await readQuoteLogMandy();
  const MAX_QTY = 10000; // calculator ceiling — above this Eli quotes via the factory.
  const hold: number[] = [];
  for (const m of mandy) {
    if (m.qty > MAX_QTY) { console.log(`  ${m.quoteNo.padEnd(11)} q=${m.qty} > ${MAX_QTY} → OUT OF SCOPE (factory handles)`); continue; }
    const pr = predict(m); if (pr == null) { console.log(`  ${m.quoteNo}: no fit for tier`); continue; }
    const err = (pr - m.unit) / m.unit * 100; hold.push(err);
    console.log(`  ${m.quoteNo.padEnd(11)} ${m.dims.padEnd(13)} a=${m.area.toFixed(0).padStart(5)} q=${String(m.qty).padStart(6)} ${m.hasHandles ? "H" : "-"}${m.hasLam ? "L" : "-"} | actual=¥${m.unit} pred=¥${pr.toFixed(2)} err=${err.toFixed(1)}%`);
  }
  if (hold.length) { const h = pctStats(hold); console.log(`\n  HOLD-OUT (qty ≤ ${MAX_QTY}): mean=${h.mean.toFixed(1)}% median|%|=${h.median.toFixed(1)}% p90=${h.p90.toFixed(1)}% max=${h.max.toFixed(1)}% (n=${h.n})`); console.log(`  GATE (median|%| ≤ 10%): ${h.median <= 10 ? "PASS ✅" : "FAIL ❌"}`); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

/**
 * DOES folding real quotes into the fit improve green accuracy? Honest LOO test.
 *  - CATALOG-ONLY: predict each real quote from the catalog (current behaviour).
 *  - CATALOG+QUOTES: decompose each quote into an implied base/lam point and refit;
 *    predict quote i from catalog + all OTHER quotes (leave-one-out, never itself).
 * Split base vs lam so we see WHERE folding helps (expected: lam calibration, not base).
 * READ-ONLY.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { feishuFetch } from "@/lib/feishu/client";
import { extractFeishu, buildModel, bagAreaCm2, normSupplier, colorsFromText, type Pt } from "@/lib/factory/server/estimator-fit";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const TIERS = [3000, 5000, 10000];
const txt = (c: unknown) => Array.isArray(c) ? c.map((s: any) => s?.text ?? "").join("") : c == null ? "" : String(c);
const numOf = (s: unknown) => { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const plateOf = (s: string): number | null => { const m = s.match(/￥\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };
const dimsName = (n: string) => { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };
const parseHandle = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);
const snapTier = (q: number) => { let t = TIERS[0]; for (const x of TIERS) if (x <= q) t = x; return t; };
// affine least squares w/ non-negativity fallback (mirror of lib)
function affine(xs: number[], ys: number[]) { const n = xs.length; if (n < 2) return null; const xb = xs.reduce((a, b) => a + b) / n, yb = ys.reduce((a, b) => a + b) / n; let nu = 0, de = 0; for (let i = 0; i < n; i++) { nu += (xs[i] - xb) * (ys[i] - yb); de += (xs[i] - xb) ** 2; } if (de === 0) return null; let sl = nu / de, ic = yb - sl * xb; if (sl < 0 || ic < 0) { let a = 0, b = 0; for (let i = 0; i < n; i++) { a += xs[i] * ys[i]; b += xs[i] ** 2; } sl = b ? Math.max(0, a / b) : 0; ic = 0; } return { slope: sl, intercept: ic }; }
const abs = (a: number[]) => a.map(Math.abs).sort((x, y) => x - y);
const stat = (a: number[]) => { const s = abs(a); return `חציון ${s[Math.floor(s.length / 2)].toFixed(1)}% · ממוצע ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}% · max ${s[s.length - 1].toFixed(1)}%`; };

async function h18Pts(): Promise<Pt[]> {
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const h = meta.data.sheets.find((s) => /H18-?D9-?W20/i.test(s.title)); if (!h) return [];
  const vals = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${h.sheet_id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
  const dm = dimsName(h.title)!; let hd: any = null, fin: any = null; const out: Pt[] = [];
  for (let i = 0; i < vals.length; i++) { const row = vals[i] ?? []; const hh = txt(row[1]).trim(); if (hh === "Handle" || hh === "Non") hd = hh; const f = txt(row[4]).trim().toLowerCase(); if (f === "non" || f === "laminating") fin = f; const price = numOf(row[7]); const qc = txt(row[5]); if (price == null || !hd) continue; if (!/热压/.test(qc)) continue; const qm = qc.match(/(\d{3,6})/); if (!qm) continue; const q = +qm[1]; if (!TIERS.includes(q)) continue; out.push({ factory: "Mandy", size: h.title, area: bagAreaCm2(dm.h, dm.d, dm.w), colors: null, hasHandle: hd === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" }); }
  return out;
}

interface Q { area: number; qty: number; hasHandle: boolean; hasLam: boolean; colors: number; actual: number }

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const cat = [...(await extractFeishu()).cat, ...(await h18Pts())].filter((p) => p.factory === "Mandy");
  const M0 = buildModel(cat, [], "Mandy"); // add-on coeffs (handle/color/lamHandle) come from catalog

  const rows: any[] = await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const quotes: Q[] = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "Mandy")
    .map((r) => { const ps = r.ps ?? {}, fr = r.fr ?? {}; return { area: bagAreaCm2(ps.heightCm, ps.depthCm ?? 0, ps.widthCm), qty: ps.quantity ?? 0, hasHandle: parseHandle((ps.finishing ?? "").toString()), hasLam: parseLam((ps.finishing ?? "").toString()), colors: colorsFromText((ps.printing ?? "1").toString()), actual: +fr.unitCostCny }; })
    .filter((q) => q.qty <= 10000 && q.actual > 0);

  // implied clean point from a quote (strip add-ons using catalog coeffs)
  const impliedBase = (q: Q) => q.actual - (q.hasHandle ? M0.handle[snapTier(q.qty)] : 0) - (q.colors > 1 ? (M0.color[snapTier(q.qty)][q.colors] ?? M0.color[snapTier(q.qty)][3] ?? 0) : 0);
  const impliedLam = (q: Q) => q.actual - (q.hasHandle ? M0.lamHandle[snapTier(q.qty)] : 0);

  // predict a quote given base[]/lam[] curves
  const predict = (q: Q, base: Record<number, any>, lam: Record<number, any>) => {
    const t = snapTier(q.qty);
    if (q.hasLam) { const g = lam[t]; return g.intercept + g.slope * q.area + (q.hasHandle ? M0.lamHandle[t] : 0); }
    const g = base[t]; const col = q.colors > 1 ? (M0.color[t][q.colors] ?? M0.color[t][3] ?? 0) : 0;
    return g.intercept + g.slope * q.area + col + (q.hasHandle ? M0.handle[t] : 0);
  };
  // build folded base/lam curves from catalog + a set of quotes
  const buildFolded = (qs: Q[]) => {
    const base: Record<number, any> = {}, lam: Record<number, any> = {};
    for (const t of TIERS) {
      const cb = cat.filter((p) => p.qty === t && !p.hasHandle && !p.hasLam && p.colors === 1);
      const xb = [...cb.map((p) => p.area)], yb = [...cb.map((p) => p.price)];
      for (const q of qs.filter((q) => !q.hasLam && snapTier(q.qty) === t)) { xb.push(q.area); yb.push(impliedBase(q)); }
      base[t] = affine(xb, yb) ?? M0.base[t];
      const cl = cat.filter((p) => p.qty === t && !p.hasHandle && p.hasLam);
      const xl = [...cl.map((p) => p.area)], yl = [...cl.map((p) => p.price)];
      for (const q of qs.filter((q) => q.hasLam && snapTier(q.qty) === t)) { xl.push(q.area); yl.push(impliedLam(q)); }
      lam[t] = affine(xl, yl) ?? M0.lam[t];
    }
    return { base, lam };
  };

  const eCat: number[] = [], eFold: number[] = [], eCatB: number[] = [], eFoldB: number[] = [], eCatL: number[] = [], eFoldL: number[] = [];
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    const pc = predict(q, M0.base, M0.lam);                                  // catalog only
    const others = quotes.filter((_, j) => j !== i);
    const fm = buildFolded(others);                                          // catalog + other quotes (LOO)
    const pf = predict(q, fm.base, fm.lam);
    const ec = (pc - q.actual) / q.actual * 100, ef = (pf - q.actual) / q.actual * 100;
    eCat.push(ec); eFold.push(ef); (q.hasLam ? eCatL : eCatB).push(ec); (q.hasLam ? eFoldL : eFoldB).push(ef);
  }
  console.log(`\n🟢 ניסוי: האם הכנסת ${quotes.length} הצעות אמת משפרת? (Leave-One-Out)\n`);
  console.log("               │ בלי הכנסה (קטלוג בלבד)      │ עם הכנסה (קטלוג + הצעות)");
  console.log("  " + "─".repeat(78));
  console.log(`  הכל (n=${eCat.length})     │ ${stat(eCat).padEnd(28)}│ ${stat(eFold)}`);
  console.log(`  בסיס (n=${eCatB.length})    │ ${stat(eCatB).padEnd(28)}│ ${stat(eFoldB)}`);
  console.log(`  למינציה (n=${eCatL.length}) │ ${stat(eCatL).padEnd(28)}│ ${stat(eFoldL)}`);
  const md = (a: number[]) => abs(a)[Math.floor(a.length / 2)];
  console.log("\n  שינוי בחציון |סטייה|:");
  console.log(`    בסיס:    ${md(eCatB).toFixed(1)}% → ${md(eFoldB).toFixed(1)}%  ${md(eFoldB) < md(eCatB) - 0.3 ? "✅ שיפר" : md(eFoldB) > md(eCatB) + 0.3 ? "⚠️ הרע" : "≈ ללא שינוי"}`);
  console.log(`    למינציה: ${md(eCatL).toFixed(1)}% → ${md(eFoldL).toFixed(1)}%  ${md(eFoldL) < md(eCatL) - 0.3 ? "✅ שיפר" : md(eFoldL) > md(eCatL) + 0.3 ? "⚠️ הרע" : "≈ ללא שינוי"}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

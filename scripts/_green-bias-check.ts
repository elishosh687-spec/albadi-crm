/**
 * Is the green base residual (~-3.4%) a real systematic bias or small-sample noise?
 * Uses the SAME base residuals (out-of-sample: base is catalog-only, quotes never
 * fed it). Reports sign split, spread, 95% CI (t), and splits lam vs non-lam.
 * READ-ONLY.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { feishuFetch } from "@/lib/feishu/client";
import { extractFeishu, buildModel, predict, bagAreaCm2, normSupplier, colorsFromText, type Pt } from "@/lib/factory/server/estimator-fit";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const TIERS = [3000, 5000, 10000];
const txt = (c: unknown) => Array.isArray(c) ? c.map((s: any) => s?.text ?? "").join("") : c == null ? "" : String(c);
const numOf = (s: unknown) => { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const colorsOf = (s: string): number | null => { if (/\//.test(s)) return null; const m = s.match(/(\d+)\s*colou?r/i); return m ? +m[1] : null; };
const plateOf = (s: string): number | null => { const m = s.match(/￥\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };
const dimsName = (n: string) => { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };
const parseHandle = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);

async function h18Pts(): Promise<Pt[]> {
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const h = meta.data.sheets.find((s) => /H18-?D9-?W20/i.test(s.title)); if (!h) return [];
  const vals = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${h.sheet_id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
  const dm = dimsName(h.title)!; let hd: "Handle" | "Non" | null = null, fin: "non" | "laminating" | null = null; const out: Pt[] = [];
  for (let i = 0; i < vals.length; i++) { const row = vals[i] ?? []; const hh = txt(row[1]).trim(); if (hh === "Handle" || hh === "Non") hd = hh; const f = txt(row[4]).trim().toLowerCase(); if (f === "non" || f === "laminating") fin = f as any; const price = numOf(row[7]); const qc = txt(row[5]); if (price == null || !hd) continue; if (!/热压/.test(qc)) continue; const qm = qc.match(/(\d{3,6})/); if (!qm) continue; const q = +qm[1]; if (!TIERS.includes(q)) continue; out.push({ factory: "Mandy", size: h.title, area: bagAreaCm2(dm.h, dm.d, dm.w), colors: colorsOf(txt(row[3])), hasHandle: hd === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" }); }
  return out;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const T975: Record<number, number> = { 1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23 };
function report(label: string, es: number[]) {
  if (es.length < 2) { console.log(`  ${label}: n=${es.length} — מעט מדי`); return; }
  const m = mean(es), s = sd(es), se = s / Math.sqrt(es.length), t = T975[es.length - 1] ?? 2.0, lo = m - t * se, hi = m + t * se;
  const neg = es.filter((e) => e < 0).length, pos = es.filter((e) => e > 0).length;
  const crossesZero = lo < 0 && hi > 0;
  console.log(`  ${label}: n=${es.length} · ממוצע ${m.toFixed(1)}% · סטיית תקן ${s.toFixed(1)}% · כיוון: ${neg}⬇/${pos}⬆`);
  console.log(`      95% CI: [${lo.toFixed(1)}% , ${hi.toFixed(1)}%]  → ${crossesZero ? "❓ חוצה 0 = לא מובהק (רעש סביר)" : "✅ לא חוצה 0 = הטיה מובהקת"}`);
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const model = buildModel([...(await extractFeishu()).cat, ...(await h18Pts())], [], "Mandy");
  const rows: any[] = await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const mine = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "Mandy");
  const all: number[] = [], lam: number[] = [], nolam: number[] = [];
  console.log("\nפערי בסיס (מפעל→מחשבון), כמות ≤10,000:\n");
  for (const r of mine) {
    const ps = r.ps ?? {}, fr = r.fr ?? {}; const qty = ps.quantity ?? 0; if (qty > 10000) continue;
    const area = bagAreaCm2(ps.heightCm, ps.depthCm ?? 0, ps.widthCm);
    const hasL = parseLam((ps.finishing ?? "").toString()), hasH = parseHandle((ps.finishing ?? "").toString());
    const pr = predict(model, { area, qty, hasHandle: hasH, hasLam: hasL, colors: colorsFromText((ps.printing ?? "1").toString()) });
    if (!pr || !(fr.unitCostCny > 0)) continue;
    const e = (pr.unit - fr.unitCostCny) / fr.unitCostCny * 100;
    all.push(e); (hasL ? lam : nolam).push(e);
    console.log(`  ${`${ps.heightCm}×${ps.widthCm}×D${ps.depthCm ?? 0}`.padEnd(12)} ${hasL ? "למינציה" : "רגיל  "} → ${e >= 0 ? "+" : ""}${e.toFixed(1)}%`);
  }
  console.log("\n── ניתוח עקביות ──");
  report("הכל", all);
  report("בלי למינציה (בסיס נקי)", nolam);
  report("עם למינציה", lam);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

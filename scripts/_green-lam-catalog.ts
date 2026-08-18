/**
 * Validate the lamination curve from the CATALOG itself (green/华庆):
 *  A) In-sample fit — does our lam[q] affine reproduce the catalog's own laminated
 *     rows? (loose fit → the -5% vs quotes is partly OUR error; tight fit → the -5%
 *     is a real factory markup over its own catalog.)
 *  B) Lamination premium in the catalog — for sizes with BOTH base & lam rows, show
 *     lam−base per qty, so we see the real structure the formula must capture.
 * READ-ONLY. No DB (pure catalog).
 */
import "dotenv/config";
import { feishuFetch } from "@/lib/feishu/client";
import { extractFeishu, buildModel, bagAreaCm2, type Pt } from "@/lib/factory/server/estimator-fit";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const TIERS = [3000, 5000, 10000];
const txt = (c: unknown) => Array.isArray(c) ? c.map((s: any) => s?.text ?? "").join("") : c == null ? "" : String(c);
const numOf = (s: unknown) => { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const colorsOf = (s: string): number | null => { if (/\//.test(s)) return null; const m = s.match(/(\d+)\s*colou?r/i); return m ? +m[1] : null; };
const plateOf = (s: string): number | null => { const m = s.match(/￥\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };
const dimsName = (n: string) => { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };

async function h18Pts(): Promise<Pt[]> {
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const h = meta.data.sheets.find((s) => /H18-?D9-?W20/i.test(s.title)); if (!h) return [];
  const vals = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${h.sheet_id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
  const dm = dimsName(h.title)!; let hd: "Handle" | "Non" | null = null, fin: "non" | "laminating" | null = null; const out: Pt[] = [];
  for (let i = 0; i < vals.length; i++) { const row = vals[i] ?? []; const hh = txt(row[1]).trim(); if (hh === "Handle" || hh === "Non") hd = hh; const f = txt(row[4]).trim().toLowerCase(); if (f === "non" || f === "laminating") fin = f as any; const price = numOf(row[7]); const qc = txt(row[5]); if (price == null || !hd) continue; if (!/热压/.test(qc)) continue; const qm = qc.match(/(\d{3,6})/); if (!qm) continue; const q = +qm[1]; if (!TIERS.includes(q)) continue; out.push({ factory: "Mandy", size: h.title, area: bagAreaCm2(dm.h, dm.d, dm.w), colors: colorsOf(txt(row[3])), hasHandle: hd === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" }); }
  return out;
}

async function main() {
  const cat = [...(await extractFeishu()).cat, ...(await h18Pts())].filter((p) => p.factory === "Mandy");
  const model = buildModel(cat, [], "Mandy");

  // A) in-sample fit of the lam curve on catalog laminated rows (no handle, 1 colour)
  console.log("\n═══ A) התאמת עקומת הלמינציה לקטלוג עצמו (in-sample) ═══");
  console.log("   נקודות למינציה בקטלוג (בלי ידית, צבע 1) — קטלוג מול העקומה שלנו:\n");
  const errs: number[] = [];
  for (const q of TIERS) {
    const g = model.lam[q]; if (!g) { console.log(`   [${q}] אין עקומה`); continue; }
    const pts = cat.filter((p) => p.qty === q && p.hasLam && !p.hasHandle && p.colors === 1).sort((a, b) => a.area - b.area);
    for (const p of pts) { const pred = g.intercept + g.slope * p.area; const e = (pred - p.price) / p.price * 100; errs.push(e); console.log(`   [${q}] ${p.size.padEnd(15)} שטח ${String(Math.round(p.area)).padStart(4)} · קטלוג ¥${p.price.toFixed(2)} → עקומה ¥${pred.toFixed(2)}  ${e >= 0 ? "+" : ""}${e.toFixed(1)}%`); }
  }
  if (errs.length) { const abs = errs.map(Math.abs).sort((a, b) => a - b); console.log(`\n   סטייה חציונית (in-sample) ${abs[Math.floor(abs.length / 2)].toFixed(1)}% · max ${abs[abs.length - 1].toFixed(1)}% · n=${errs.length}`); console.log(`   ${abs[Math.floor(abs.length / 2)] < 4 ? "✅ העקומה מתארת נאמנה את הלמינציה בקטלוג → ה-‑5% מול הצעות האמת הוא פער אמיתי של המפעל, לא שגיאת מודל." : "⚠️ העקומה עצמה לא מדייקת על הקטלוג → חלק מה-‑5% הוא שגיאת מודל, לא רק המפעל."}`); }

  // B) real lamination premium in the catalog: lam − base per size/qty (no handle, 1 colour)
  console.log("\n═══ B) תוספת הלמינציה בקטלוג (למינציה − בסיס), בלי ידית, צבע 1 ═══\n");
  const prem: Record<number, number[]> = { 3000: [], 5000: [], 10000: [] };
  for (const size of [...new Set(cat.map((p) => p.size))]) {
    for (const q of TIERS) {
      const base = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && !p.hasLam && p.colors === 1)?.price;
      const lam = cat.find((p) => p.size === size && p.qty === q && !p.hasHandle && p.hasLam && p.colors === 1)?.price;
      if (base != null && lam != null) { const d = lam - base, pctAdd = d / base * 100; prem[q].push(pctAdd); if (q === 5000) console.log(`   ${size.padEnd(15)} [${q}] בסיס ¥${base.toFixed(2)} · למינציה ¥${lam.toFixed(2)} · תוספת +¥${d.toFixed(2)} (+${pctAdd.toFixed(0)}%)`); }
    }
  }
  console.log("\n   תוספת למינציה ממוצעת לפי כמות:");
  for (const q of TIERS) { const a = prem[q]; if (a.length) console.log(`     [${q}] +${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(0)}%  (n=${a.length})`); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

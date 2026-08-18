/**
 * Honest held-out test: does folding real quotes into the formula improve it on
 * quotes it NEVER saw? Catalog is always the backbone (factory pricelist, kept whole).
 * From the 7 in-domain green quotes, hold out a test set, "fold" the rest as a
 * per-segment level calibration on top of the catalog curve (catalog = shape,
 * quotes = level — no noisy add-on stripping), predict the held-out, compare vs
 * catalog-only. Rotate over ALL splits and average so one lucky draw can't fool us.
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
const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 1; };
const meanAbs = (a: number[]) => a.reduce((s, x) => s + Math.abs(x), 0) / a.length;
const meanSg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

async function h18Pts(): Promise<Pt[]> {
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const h = meta.data.sheets.find((s) => /H18-?D9-?W20/i.test(s.title)); if (!h) return [];
  const vals = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${h.sheet_id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
  const dm = dimsName(h.title)!; let hd: any = null, fin: any = null; const out: Pt[] = [];
  for (let i = 0; i < vals.length; i++) { const row = vals[i] ?? []; const hh = txt(row[1]).trim(); if (hh === "Handle" || hh === "Non") hd = hh; const f = txt(row[4]).trim().toLowerCase(); if (f === "non" || f === "laminating") fin = f; const price = numOf(row[7]); const qc = txt(row[5]); if (price == null || !hd) continue; if (!/热压/.test(qc)) continue; const qm = qc.match(/(\d{3,6})/); if (!qm) continue; const q = +qm[1]; if (!TIERS.includes(q)) continue; out.push({ factory: "Mandy", size: h.title, area: bagAreaCm2(dm.h, dm.d, dm.w), colors: null, hasHandle: hd === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" }); }
  return out;
}
interface Q { area: number; qty: number; hasHandle: boolean; hasLam: boolean; colors: number; actual: number }
// all combinations of size k from array
function combos<T>(arr: T[], k: number): T[][] { if (k === 0) return [[]]; if (k > arr.length) return []; const [h, ...t] = arr; return [...combos(t, k - 1).map((c) => [h, ...c]), ...combos(t, k)]; }

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const cat = [...(await extractFeishu()).cat, ...(await h18Pts())].filter((p) => p.factory === "Mandy");
  const M0 = buildModel(cat, [], "Mandy");
  const catPred = (q: Q) => { const t = snapTier(q.qty); if (q.hasLam) { const g = M0.lam[t]!; return g.intercept + g.slope * q.area + (q.hasHandle ? M0.lamHandle[t] : 0); } const g = M0.base[t]!; const col = q.colors > 1 ? (M0.color[t][q.colors] ?? M0.color[t][3] ?? 0) : 0; return g.intercept + g.slope * q.area + col + (q.hasHandle ? M0.handle[t] : 0); };

  const rows: any[] = await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const quotes: Q[] = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "Mandy")
    .map((r) => { const ps = r.ps ?? {}, fr = r.fr ?? {}; return { area: bagAreaCm2(ps.heightCm, ps.depthCm ?? 0, ps.widthCm), qty: ps.quantity ?? 0, hasHandle: parseHandle((ps.finishing ?? "").toString()), hasLam: parseLam((ps.finishing ?? "").toString()), colors: colorsFromText((ps.printing ?? "1").toString()), actual: +fr.unitCostCny }; })
    .filter((q) => q.qty <= 10000 && q.actual > 0);

  const idx = quotes.map((_, i) => i);
  const HOLD = 3; // test-set size per split; train = 4
  const testSets = combos(idx, HOLD);
  const aAbs: number[] = [], bAbs: number[] = [], aSg: number[] = [], bSg: number[] = [];
  for (const test of testSets) {
    const train = idx.filter((i) => !test.includes(i));
    // per-segment level factor from TRAIN only
    const rBase = median(train.filter((i) => !quotes[i].hasLam).map((i) => quotes[i].actual / catPred(quotes[i])));
    const rLam = median(train.filter((i) => quotes[i].hasLam).map((i) => quotes[i].actual / catPred(quotes[i])));
    for (const i of test) {
      const q = quotes[i], cp = catPred(q);
      const bp = cp * (q.hasLam ? (rLam || 1) : (rBase || 1));
      const ea = (cp - q.actual) / q.actual * 100, eb = (bp - q.actual) / q.actual * 100;
      aAbs.push(Math.abs(ea)); bAbs.push(Math.abs(eb)); aSg.push(ea); bSg.push(eb);
    }
  }
  console.log(`\n🟢 מבחן held-out מוצלב: ${quotes.length} הצעות · כל פעם ${HOLD} בחוץ / 4 בפנים · ${testSets.length} חלוקות · ${aAbs.length} תחזיות-מבחן\n`);
  console.log("                       │ קטלוג בלבד        │ קטלוג + הצעות (כיול)");
  console.log("  " + "─".repeat(64));
  console.log(`  שגיאה מוחלטת ממוצעת   │ ${meanAbs(aAbs).toFixed(2)}%            │ ${meanAbs(bAbs).toFixed(2)}%   ${meanAbs(bAbs) < meanAbs(aAbs) - 0.2 ? "✅ שיפר" : meanAbs(bAbs) > meanAbs(aAbs) + 0.2 ? "⚠️ הרע" : "≈"}`);
  console.log(`  הטיה ממוצעת (מגמה)    │ ${meanSg(aSg).toFixed(2)}%            │ ${meanSg(bSg).toFixed(2)}%   ${Math.abs(meanSg(bSg)) < Math.abs(meanSg(aSg)) - 0.2 ? "✅ פחות מוטה" : "≈"}`);
  console.log("\n  (הצעות המבחן אף פעם לא שימשו לכיול — יושר מלא. הקטלוג תמיד בפנים כעמוד שדרה.)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

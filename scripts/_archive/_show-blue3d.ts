/**
 * Blue (亚森) × 3D — same exercise as green. Expand the blue catalog to 8 3D sizes
 * (add the single-supplier tabs H15-D5-W20 + H50-D20-W60 via D2, like H18 for green),
 * build base+shipping, and validate vs real blue quotes filtered to 3D IN-DOMAIN
 * (D>2, H>=10, qty 3000-10000, gusseted, non-lam — 亚森 sews lamination → factory).
 * READ-ONLY.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { feishuFetch } from "@/lib/feishu/client";
import { extractFeishu, buildModel, predict, bagAreaCm2, normSupplier, colorsFromText, isGussetedNormal, type Pt } from "@/lib/factory/server/estimator-fit";
import { DEFAULT_CARTON_COEF } from "@/lib/factory/estimator-config";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const T_BLUE = DEFAULT_CARTON_COEF.perFactoryTMm!["亚森"]; // 0.78
const TIERS = [3000, 5000, 10000];
// blue × 3D = MID-RANGE only. The extremes H15-D5-W20 (floor price) and
// H50-D20-W60 (super-linear big-bag price) break the straight line → excluded;
// they get an exact catalog price or route to factory, not the formula.
const BLUE_SINGLE_3D: string[] = [];
const txt = (c: unknown) => Array.isArray(c) ? c.map((s: any) => s?.text ?? "").join("") : c == null ? "" : String(c);
const numOf = (s: unknown) => { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const colorsOf = (s: string): number | null => { if (/\//.test(s)) return null; const m = s.match(/(\d+)\s*colou?r/i); return m ? +m[1] : null; };
const plateOf = (s: string): number | null => { const m = s.match(/￥\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };
const dimsName = (n: string) => { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };
const parseHandle = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);
const pctS = (e: number) => `${e >= 0 ? "+" : ""}${e.toFixed(0)}%${Math.abs(e) > 12 ? "❌" : Math.abs(e) > 8 ? "⚠️" : "✅"}`;

async function singleTabPts(titleRe: RegExp, factory: string): Promise<Pt[]> {
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const t = meta.data.sheets.find((s) => titleRe.test(s.title)); if (!t) return [];
  const vals = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${t.sheet_id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
  const dm = dimsName(t.title)!; let hd: any = null, fin: any = null; const out: Pt[] = [];
  for (let i = 0; i < vals.length; i++) { const row = vals[i] ?? []; const hh = txt(row[1]).trim(); if (hh === "Handle" || hh === "Non") hd = hh; const f = txt(row[4]).trim().toLowerCase(); if (f === "non" || f === "laminating") fin = f; const price = numOf(row[7]); const qc = txt(row[5]); if (price == null || !hd) continue; if (!/热压/.test(qc)) continue; const qm = qc.match(/(\d{3,6})/); if (!qm) continue; const q = +qm[1]; if (!TIERS.includes(q)) continue; out.push({ factory, size: t.title, area: bagAreaCm2(dm.h, dm.d, dm.w), colors: colorsOf(txt(row[3])), hasHandle: hd === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" }); }
  return out;
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const singles = (await Promise.all(BLUE_SINGLE_3D.map((s) => singleTabPts(new RegExp(s.replace(/-/g, "-?"), "i"), "亚森")))).flat();
  const cat = [...(await extractFeishu()).cat, ...singles];
  const model = buildModel(cat, [], "亚森");
  const sizes = [...new Set(cat.filter((p) => p.factory === "亚森").map((p) => p.size))];
  console.log(`\n🔵 כחול (亚森) × 3D · T=${T_BLUE}mm · קטלוג ${sizes.length} מידות: ${sizes.join(", ")}`);
  console.log(`   טווח שטח: ${Math.round(model.areaMin)}–${Math.round(model.areaMax)} ס"מ²  (נוספו: ${singles.length ? [...new Set(singles.map(p=>p.size))].join(", ") : "—"})\n`);

  const rows: any[] = await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const mine = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "亚森")
    .sort((a, b) => (a.ps?.quantity ?? 0) - (b.ps?.quantity ?? 0));

  console.log("  שקית          כמות  וריאנט        │ בסיס: מפעל→נוסחה           │ שילוח m³/1000: מפעל→נוסחה   │ מצב");
  console.log("  " + "─".repeat(108));
  const inB: number[] = [], inS: number[] = [];
  for (const r of mine) {
    const ps = r.ps ?? {}, fr = r.fr ?? {}; const d = ps.depthCm ?? 0, h = ps.heightCm, w = ps.widthCm;
    const area = bagAreaCm2(h, d, w), qty = ps.quantity ?? 0;
    const hasH = parseHandle((ps.finishing ?? "").toString()), hasL = parseLam((ps.finishing ?? "").toString()), cols = colorsFromText((ps.printing ?? "1").toString());
    // scope: blue × 3D in-domain
    const is3D = d > 2, gusset = isGussetedNormal({ area, depth: d, height: h }), inQty = qty >= 3000 && qty <= 10000;
    let why = "";
    if (!is3D) why = "2D→תא נפרד"; else if (!gusset) why = "מגש/מחוץ"; else if (!inQty) why = qty < 3000 ? "qty<3000" : "qty>10000"; else if (hasL) why = "למינציה→מפעל";
    const inScope = !why;

    const pr = predict(model, { area, qty, hasHandle: hasH, hasLam: hasL, colors: cols });
    let bCell = "—";
    if (pr && fr.unitCostCny > 0) { const e = (pr.unit - fr.unitCostCny) / fr.unitCostCny * 100; if (inScope) inB.push(e); bCell = `¥${(+fr.unitCostCny).toFixed(2)}→¥${pr.unit.toFixed(2)} ${pctS(e)}`; }
    else if (!pr) bCell = hasL ? "אין נוסחת למ" : "—";
    let sCell = "—";
    if (fr.cartonQty > 0 && fr.cartonCbm > 0 && d > 2) { const act = (fr.cartonCbm / fr.cartonQty) * 1000, prd = T_BLUE * area * 1e-7 * 1000, e = (prd - act) / act * 100; if (inScope) inS.push(e); sCell = `${act.toFixed(2)}→${prd.toFixed(2)} ${pctS(e)}`; }
    console.log(`  ${`${h}×${w}×D${d}`.padEnd(13)} ${String(qty).padStart(5)} ${`${hasH ? "ידית" : "בלי "}${hasL ? "+למ" : ""} ${cols}צ`.padEnd(12)}│ ${bCell.padEnd(26)}│ ${sCell.padEnd(24)}│ ${inScope ? "✅ בתחום" : "· " + why}`);
  }
  const md = (a: number[]) => { const s = a.map(Math.abs).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const mn = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  console.log(`\n── סיכום כחול × 3D בתחום בלבד ──`);
  console.log(`  בסיס:  n=${inB.length} · חציון |${md(inB).toFixed(1)}%| · הטיה ${mn(inB).toFixed(1)}%`);
  console.log(`  שילוח: n=${inS.length} · חציון |${md(inS).toFixed(1)}%| · הטיה ${mn(inS).toFixed(1)}%`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

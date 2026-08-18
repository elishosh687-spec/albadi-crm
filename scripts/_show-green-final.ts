/**
 * Clean side-by-side: for each real GREEN (华庆/Mandy) quote in factory_quote_requests,
 * show what the FACTORY actually quoted (base ¥/unit + shipping) vs what OUR estimator
 * predicts. Green model includes the newly-added H18-D9-W20 tab. READ-ONLY.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { feishuFetch } from "@/lib/feishu/client";
import { extractFeishu, buildModel, predict, bagAreaCm2, normSupplier, colorsFromText, type Pt } from "@/lib/factory/server/estimator-fit";
import { DEFAULT_CARTON_COEF } from "@/lib/factory/estimator-config";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const T_MANDY = DEFAULT_CARTON_COEF.perFactoryTMm!["Mandy"];
const TIERS = [3000, 5000, 10000];
const txt = (c: unknown) => Array.isArray(c) ? c.map((s: any) => s?.text ?? "").join("") : c == null ? "" : String(c);
const numOf = (s: unknown) => { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const colorsOf = (s: string): number | null => { if (/\//.test(s)) return null; const m = s.match(/(\d+)\s*colou?r/i); return m ? +m[1] : null; };
const plateOf = (s: string): number | null => { const m = s.match(/￥\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };
const dimsName = (n: string) => { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };
const parseHandle = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);
const pctS = (e: number) => `${e >= 0 ? "+" : ""}${e.toFixed(0)}%${Math.abs(e) > 12 ? "❌" : Math.abs(e) > 8 ? "⚠️" : "✅"}`;

async function h18Pts(): Promise<Pt[]> {
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const h18 = meta.data.sheets.find((s) => /H18-?D9-?W20/i.test(s.title)); if (!h18) return [];
  const vals = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${h18.sheet_id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
  const dm = dimsName(h18.title)!; let handle: "Handle" | "Non" | null = null, fin: "non" | "laminating" | null = null; const out: Pt[] = [];
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i] ?? []; const h = txt(row[1]).trim(); if (h === "Handle" || h === "Non") handle = h;
    const f = txt(row[4]).trim().toLowerCase(); if (f === "non" || f === "laminating") fin = f as any;
    const price = numOf(row[7]); const qcell = txt(row[5]); if (price == null || !handle) continue;
    if (!/热压/.test(qcell)) continue; const qm = qcell.match(/(\d{3,6})/); if (!qm) continue; const q = +qm[1]; if (!TIERS.includes(q)) continue;
    out.push({ factory: "Mandy", size: h18.title, area: bagAreaCm2(dm.h, dm.d, dm.w), colors: colorsOf(txt(row[3])), hasHandle: handle === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" });
  }
  return out;
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const { cat, ql } = await extractFeishu();
  const model = buildModel([...cat, ...(await h18Pts())], ql, "Mandy");
  const rows: any[] = await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const mine = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "Mandy")
                   .sort((a, b) => (a.ps?.quantity ?? 0) - (b.ps?.quantity ?? 0));

  console.log("\n🟢 מפעל ירוק (华庆/Mandy) — הצעה אמיתית מול המחשבון המשוער\n");
  console.log("  שקית          כמות  וריאנט        │ בסיס ¥/יח׳: מפעל→מחשבון      │ שילוח m³/1000 יח׳: מפעל→מחשבון");
  console.log("  " + "─".repeat(104));
  const inB: number[] = [], inS: number[] = [];
  for (const r of mine) {
    const ps = r.ps ?? {}, fr = r.fr ?? {};
    const d = ps.depthCm ?? 0, area = bagAreaCm2(ps.heightCm, d, ps.widthCm), qty = ps.quantity ?? 0;
    const over = qty > 10000;
    const hasH = parseHandle((ps.finishing ?? "").toString()), hasL = parseLam((ps.finishing ?? "").toString()), cols = colorsFromText((ps.printing ?? "1").toString());
    const variant = `${hasH ? "ידית" : "בלי "}${hasL ? "+למ" : "   "} ${cols}צבע`;

    const pr = predict(model, { area, qty, hasHandle: hasH, hasLam: hasL, colors: cols });
    let bCell = "—";
    if (pr && fr.unitCostCny > 0) { const e = (pr.unit - fr.unitCostCny) / fr.unitCostCny * 100; if (!over) inB.push(e); bCell = `¥${(+fr.unitCostCny).toFixed(2)} → ¥${pr.unit.toFixed(2)}  ${pctS(e)}`; }

    let sCell = "—";
    if (fr.cartonQty > 0 && fr.cartonCbm > 0 && d > 2) {
      const act = (fr.cartonCbm / fr.cartonQty) * 1000, prd = T_MANDY * area * 1e-7 * 1000, e = (prd - act) / act * 100;
      if (!over) inS.push(e); sCell = `${act.toFixed(2)} → ${prd.toFixed(2)}  ${pctS(e)}`;
    }
    const tag = `${ps.heightCm}×${ps.widthCm}×D${d}`;
    console.log(`  ${tag.padEnd(13)} ${String(qty).padStart(6)}${over ? "*" : " "} ${variant.padEnd(12)} │ ${bCell.padEnd(28)} │ ${sCell}`);
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const med = (a: number[]) => { const s = a.map(Math.abs).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  console.log("\n  * = כמות מעל 10,000 = מחוץ לתחום הנוסחה (לא נספר)\n");
  console.log(`  בסיס:  ${inB.length} הצעות · סטייה חציונית ${med(inB).toFixed(1)}% · הטיה ממוצעת ${avg(inB).toFixed(1)}%`);
  console.log(`  שילוח: ${inS.length} הצעות · סטייה חציונית ${med(inS).toFixed(1)}% · הטיה ממוצעת ${avg(inS).toFixed(1)}%`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

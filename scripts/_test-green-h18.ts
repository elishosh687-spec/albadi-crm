/**
 * Research-only: add the newly-identified GREEN single-supplier tab H18-D9-W20
 * (D2 = 浙江华庆塑业 = Mandy, but its price cells are neutral D9DCE1 so the live
 * COLOR_FACTORY reader drops it) into the green catalog, refit, and re-validate
 * vs the 11 real green quotes. Confirms the numbers stay stable. READ-ONLY DB.
 * Does NOT touch estimator-fit.ts / the live reader.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { feishuFetch } from "@/lib/feishu/client";
import { extractFeishu, buildModel, predict, pct, bagAreaCm2, normSupplier, colorsFromText, type Pt } from "@/lib/factory/server/estimator-fit";
import { DEFAULT_CARTON_COEF } from "@/lib/factory/estimator-config";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const T_MANDY = DEFAULT_CARTON_COEF.perFactoryTMm!["Mandy"];
const TIERS = [3000, 5000, 10000];

// tiny local re-impls (not exported from estimator-fit)
const txt = (c: unknown) => Array.isArray(c) ? c.map((s: any) => s?.text ?? "").join("") : c == null ? "" : String(c);
const numOf = (s: unknown) => { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const colorsOf = (s: string): number | null => { if (/\//.test(s)) return null; const m = s.match(/(\d+)\s*colou?r/i); return m ? +m[1] : null; };
const plateOf = (s: string): number | null => { const m = s.match(/￥\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };
const dimsName = (n: string) => { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };
const parseHandle = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);

async function readTabValues(sheetId: string): Promise<unknown[][]> {
  const r = await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(
    `/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${sheetId}!A1:Z120`)}`, { method: "GET" });
  return r.data?.valueRange?.values ?? [];
}

// parse a SINGLE-supplier tab straight from values (no cell-colour needed).
function parseSingleTab(title: string, vals: unknown[][], factory: string): Pt[] {
  const dm = dimsName(title); if (!dm) return [];
  let handle: "Handle" | "Non" | null = null, fin: "non" | "laminating" | null = null;
  const out: Pt[] = [];
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i] ?? [];
    const h = txt(row[1]).trim(); if (h === "Handle" || h === "Non") handle = h;
    const f = txt(row[4]).trim().toLowerCase(); if (f === "non" || f === "laminating") fin = f as any;
    const price = numOf(row[7]); const qcell = txt(row[5]);
    if (price == null || !handle) continue;
    if (!/热压/.test(qcell)) continue; const qm = qcell.match(/(\d{3,6})/); if (!qm) continue;
    const q = +qm[1]; if (!TIERS.includes(q)) continue;
    out.push({ factory, size: title, area: bagAreaCm2(dm.h, dm.d, dm.w), colors: colorsOf(txt(row[3])), hasHandle: handle === "Handle", hasLam: fin === "laminating", qty: q, price, plateFee: plateOf(txt(row[6])), src: "catalog" });
  }
  return out;
}

async function validate(label: string, cat: Pt[], ql: Pt[], sql: any) {
  const model = buildModel(cat, ql, "Mandy");
  const rows: any[] = await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const mine = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "Mandy");
  const perr: number[] = [];
  for (const r of mine) {
    const ps = r.ps ?? {}, fr = r.fr ?? {};
    if ((ps.quantity ?? 0) > 10000) continue;
    const area = bagAreaCm2(ps.heightCm, ps.depthCm ?? 0, ps.widthCm);
    const pr = predict(model, { area, qty: ps.quantity ?? 0, hasHandle: parseHandle((ps.finishing ?? "").toString()), hasLam: parseLam((ps.finishing ?? "").toString()), colors: colorsFromText((ps.printing ?? "1").toString()) });
    if (pr && fr.unitCostCny > 0) perr.push((pr.unit - fr.unitCostCny) / fr.unitCostCny * 100);
  }
  const s = pct(perr);
  const greenSizes = [...new Set(cat.filter((p) => p.factory === "Mandy").map((p) => p.size))];
  console.log(`\n${label}`);
  console.log(`  מידות ירוקות (${greenSizes.length}): ${greenSizes.join(", ")}`);
  console.log(`  areaMin=${Math.round(model.areaMin)} areaMax=${Math.round(model.areaMax)}`);
  console.log(`  מחיר: n=${s.n} · |חציון| ${Math.abs(s.median).toFixed(1)}% · ממוצע ${s.mean.toFixed(1)}% · max ${s.max.toFixed(0)}% · ≤8%: ${perr.filter((e) => Math.abs(e) <= 8).length}/${perr.length}`);
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // supplier field proof (Eli's Q2)
  const sup: any[] = await sql`SELECT factory_response->>'supplier' AS supplier, COUNT(*) n FROM factory_quote_requests GROUP BY 1 ORDER BY n DESC`;
  console.log("═══ שדה הספק בטבלת ההצעות (factory_response.supplier) ═══");
  for (const r of sup) console.log(`  ${String(r.supplier ?? "(ריק)").padEnd(30)} → ${r.n}  [normSupplier: ${normSupplier((r.supplier ?? "").toString())}]`);

  const { cat, ql } = await extractFeishu();
  await validate("── לפני: ירוק כמו שהקורא החי רואה ──", cat, ql, sql);

  // read H18-D9-W20 tab and attach as Mandy
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const h18 = meta.data.sheets.find((s) => /H18-?D9-?W20/i.test(s.title));
  if (!h18) { console.log("\n⚠️ לא נמצא טאב H18-D9-W20"); process.exit(1); }
  const pts = parseSingleTab(h18.title, await readTabValues(h18.sheet_id), "Mandy");
  console.log(`\n+ נוספו ${pts.length} נקודות מ-${h18.title} (华庆/Mandy, ${[...new Set(pts.map(p=>p.qty))].join("/")})`);
  await validate("── אחרי: ירוק + H18-D9-W20 ──", [...cat, ...pts], ql, sql);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

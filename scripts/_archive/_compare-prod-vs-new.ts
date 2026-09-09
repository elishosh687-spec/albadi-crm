/**
 * Compare the PRODUCTION estimator (coeffs served from app_config) vs a FRESH
 * refit (catalog + fixed quote-log reader), both through estimateFactoryCny,
 * against the real 3D quotes in the CSV. READ-ONLY.
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";
import { getEstimatorCoeffs } from "@/lib/factory/estimator-config";
import { extractFeishu, buildModel, looValidate, toCoeffs, catalogCartonPts, toCartonCoef } from "@/lib/factory/server/estimator-fit";

const CSV = process.argv[2] || "/Users/eli/Downloads/non-woven Quotation-Eli - 报价单 (1).csv";
function parseCSV(t: string): string[][] { const rows: string[][] = []; let row: string[] = [], f = "", q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c; } if (f || row.length) { row.push(f); rows.push(row); } return rows; }
const dims = (s: string) => { const m = (s || "").replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };
const num = (s: string) => { const m = (s || "").replace(/[￥¥,]/g, "").match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
const is80nw = (m: string) => /80\s*(g|克|gsm)/i.test(m || "") && /(non-woven|无纺布)/i.test(m || "");
const colorsOf = (s: string) => { const m = (s || "").match(/(\d+)/); return m ? +m[0] : 1; };
const pH = (f: string) => /with handle|handles\b/i.test(f) && !/no handle|non handle/i.test(f);
const pL = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);
const cell = (v: number | undefined, actual: number) => v == null ? "—" : `¥${v.toFixed(2)} ${(((v - actual) / actual * 100) >= 0 ? "+" : "")}${((v - actual) / actual * 100).toFixed(0)}%`;

async function main() {
  const prod = await getEstimatorCoeffs();
  const { cat, ql } = await extractFeishu();
  const fresh = toCoeffs(cat, ql, looValidate(cat, ql), "2026-07-03", toCartonCoef(catalogCartonPts(), "2026-07-03"));
  console.log(`מקדמי פרודקשן: fittedAt=${prod.fittedAt} · מקדמי טרי: עכשיו (עם quote-log מתוקן)\n`);

  const rows = parseCSV(readFileSync(CSV, "utf8")).filter((r) => r.length > 18 && dims(r[7]) && is80nw(r[6]) && (dims(r[7])!.d > 0));
  console.log(" שקית          כמות  וריאנט      ספק-אמת   אמת   │ פרודקשן              │ טרי");
  console.log(" " + "─".repeat(96));
  const eProd: number[] = [], eNew: number[] = [];
  for (const r of rows.sort((a, b) => (num(a[10]) ?? 0) - (num(b[10]) ?? 0))) {
    const d = dims(r[7])!; const spec: EstimateSpec = { heightCm: d.h, depthCm: d.d, widthCm: d.w, quantity: num(r[10]) ?? 0, hasHandles: pH(r[9]), hasLamination: pL(r[9]), logoColors: colorsOf(r[8]) };
    const actual = num(r[11]) ?? 0;
    const rp = await estimateFactoryCny(spec, prod, { measure: true });
    const rn = await estimateFactoryCny(spec, fresh, { measure: true });
    const pc = rp.ok ? cell(rp.factoryUnitCostCny, actual) : "סירוב";
    const nc = rn.ok ? cell(rn.factoryUnitCostCny, actual) : "סירוב";
    if (rp.ok && rp.factoryUnitCostCny) eProd.push((rp.factoryUnitCostCny - actual) / actual * 100);
    if (rn.ok && rn.factoryUnitCostCny) eNew.push((rn.factoryUnitCostCny - actual) / actual * 100);
    const sup = (r[18] || "").replace(/浙江|温州|有限公司|-Mandy|制袋|新材料科技|塑业/g, "").slice(0, 6);
    console.log(` ${`${d.h}×${d.w}×D${d.d}`.padEnd(13)} ${String(spec.quantity).padStart(5)} ${`${spec.hasHandles ? "יד" : "בלי"}${spec.hasLamination ? "+למ" : ""} ${spec.logoColors}צ`.padEnd(10)} ${sup.padEnd(7)} ¥${actual.toFixed(2)} │ ${(rp.ok ? `${rp.factoryName?.slice(0,4)} ${pc}` : pc).padEnd(20)}│ ${rn.ok ? `${rn.factoryName?.slice(0,4)} ${nc}` : nc}`);
  }
  const md = (a: number[]) => { const s = a.map(Math.abs).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const mn = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  console.log(`\n── סיכום (${rows.length} הצעות 3D) ──`);
  console.log(`  פרודקשן: נוחזו ${eProd.length} · חציון |${md(eProd).toFixed(1)}%| · הטיה ${mn(eProd).toFixed(1)}%`);
  console.log(`  טרי:     נוחזו ${eNew.length} · חציון |${md(eNew).toFixed(1)}%| · הטיה ${mn(eNew).toFixed(1)}%`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

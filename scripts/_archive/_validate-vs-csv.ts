/**
 * Re-validate GREEN + BLUE formulas against the FRESH quote CSV (link-2 export,
 * correct columns) instead of the stale DB. READ-ONLY (reads catalog live + a
 * local CSV; touches nothing).
 * Usage: tsx _validate-vs-csv.ts "<path-to-csv>"
 */
import "dotenv/config";
import { extractFeishu, buildModel, predict, bagAreaCm2, normSupplier, colorsFromText, isGussetedNormal } from "@/lib/factory/server/estimator-fit";
import { DEFAULT_CARTON_COEF } from "@/lib/factory/estimator-config";
import { readFileSync } from "fs";

const CSV = process.argv[2] || "/Users/eli/Downloads/non-woven Quotation-Eli - 报价单 (1).csv";
const T = { Mandy: DEFAULT_CARTON_COEF.perFactoryTMm!["Mandy"], "亚森": DEFAULT_CARTON_COEF.perFactoryTMm!["亚森"] } as Record<string, number>;

function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c; }
  if (f !== "" || row.length) { row.push(f); rows.push(row); } return rows;
}
const dims = (s: string) => { const m = (s || "").replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };
const num = (s: string) => { const m = (s || "").replace(/[￥¥,]/g, "").match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
const is80nw = (m: string) => /80\s*(g|克|gsm)/i.test(m || "") && /(non-woven|无纺布)/i.test(m || "");
const pH = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|ללא/i.test(f);
const pL = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);
const pctS = (e: number) => `${e >= 0 ? "+" : ""}${e.toFixed(0)}%${Math.abs(e) > 12 ? "❌" : Math.abs(e) > 8 ? "⚠️" : "✅"}`;

async function main() {
  const { cat } = await extractFeishu();
  const models = { Mandy: buildModel(cat, [], "Mandy"), "亚森": buildModel(cat, [], "亚森") } as any;
  const rows = parseCSV(readFileSync(CSV, "utf8")).filter((r) => r.length > 18 && dims(r[7]));

  for (const [fac, label] of [["Mandy", "🟢 ירוק (华庆/Mandy)"], ["亚森", "🔵 כחול (亚森) × 3D אמצע"]] as const) {
    const m = models[fac], Tf = T[fac];
    const mine = rows.filter((r) => normSupplier(r[18]) === fac && is80nw(r[6]))
      .sort((a, b) => (num(a[10]) ?? 0) - (num(b[10]) ?? 0));
    console.log(`\n${label} — ${mine.length} הצעות 80g\n`);
    console.log("  שקית          כמות  וריאנט       │ בסיס: מפעל→נוסחה         │ שילוח m³/1000            │ מצב");
    console.log("  " + "─".repeat(100));
    const B: number[] = [], S: number[] = [];
    for (const r of mine) {
      const d = dims(r[7])!; const area = bagAreaCm2(d.h, d.d, d.w); const qty = num(r[10]) ?? 0;
      const actual = num(r[11]) ?? 0, cq = num(r[12]) ?? 0, cbm = num(r[16]) ?? 0;
      const hasH = pH(r[9]), hasL = pL(r[9]), cols = colorsFromText(r[8]);
      // scope: green = 3D any; blue = 3D mid-range gusseted, non-lam
      let why = "";
      if (fac === "亚森") { if (!(d.d > 2)) why = "2D→תא נפרד"; else if (!isGussetedNormal({ area, depth: d.d, height: d.h })) why = "מגש/מחוץ"; else if (hasL) why = "למינציה→מפעל"; else if (qty < 3000 || qty > 10000) why = qty < 3000 ? "qty<3000" : "qty>10k"; }
      else { if (d.d === 0) why = "2D(ירוק אין)"; else if (qty > 10000) why = "qty>10k"; else if (qty < 3000) why = "qty<3000"; }
      const inScope = !why;
      const pr = predict(m, { area, qty, hasHandle: hasH, hasLam: hasL, colors: cols });
      let bC = "—";
      if (pr && actual > 0) { const e = (pr.unit - actual) / actual * 100; if (inScope) B.push(e); bC = `¥${actual.toFixed(2)}→¥${pr.unit.toFixed(2)} ${pctS(e)}`; }
      else if (!pr) bC = hasL ? "אין נוסחת למ" : "—";
      let sC = "—";
      if (cq > 0 && cbm > 0 && d.d > 2) { const act = cbm / cq * 1000, prd = Tf * area * 1e-7 * 1000, e = (prd - act) / act * 100; if (inScope) S.push(e); sC = `${act.toFixed(2)}→${prd.toFixed(2)} ${pctS(e)}`; }
      console.log(`  ${`${d.h}×${d.w}×D${d.d}`.padEnd(13)} ${String(qty).padStart(5)} ${`${hasH ? "יד" : "בלי"}${hasL ? "+למ" : ""} ${cols}צ`.padEnd(11)}│ ${bC.padEnd(24)}│ ${sC.padEnd(24)}│ ${inScope ? "✅" : "· " + why}`);
    }
    const md = (a: number[]) => { const s = a.map(Math.abs).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
    const mn = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
    console.log(`\n  ── בתחום בלבד ──  בסיס: n=${B.length} חציון |${md(B).toFixed(1)}%| הטיה ${mn(B).toFixed(1)}%  ·  שילוח: n=${S.length} חציון |${md(S).toFixed(1)}%| הטיה ${mn(S).toFixed(1)}%`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

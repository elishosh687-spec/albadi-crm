/**
 * Real-quote validation: take actual factory quotes from the DB (NOT catalog),
 * run the מחשבון משוער on each spec, and compare BOTH the factory unit price (¥)
 * and the shipping CBM/unit against what the factory actually quoted.
 * Run: DATABASE_URL="$(neonctl …)" npx tsx scripts/_validate-real-quote.ts
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";

const area = (h: number, d: number, w: number) => 2 * h * w + 2 * h * d + w * d;
const pctErr = (pred: number, act: number) => ((pred - act) / act) * 100;

async function main() {
  type Resp = { supplier?: string; unitCostCny?: number; cartonQty?: number; cartonCbm?: number; cartonLengthCm?: number; cartonWidthCm?: number; cartonHeightCm?: number };
  type Spec = { material?: string; heightCm?: number; widthCm?: number; depthCm?: number; quantity?: number; printing?: string; finishing?: string };
  const rows = await db.select().from(factoryQuoteRequests);

  const seen = new Set<string>();
  const priceErrs: number[] = []; const cbmErrs: number[] = [];
  console.log("real factory quote → מחשבון משוער prediction (price ¥ + CBM/unit)\n");
  console.log("quote        H  D  W   q    fin            actual→ ¥/u  CBM/u    | est: factory  ¥/u (err)   CBM/u (err)   conf");
  for (const row of rows) {
    const resp = row.factoryResponse as Resp | null; const spec = row.productSpec as Spec | null;
    if (!resp || !spec) continue;
    const ok80 = /80\s*(g|克|gsm)/i.test(spec.material ?? "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "");
    const h = spec.heightCm ?? 0, w = spec.widthCm ?? 0, d = spec.depthCm ?? 0;
    if (!ok80 || !h || !w) continue;
    const unit = resp.unitCostCny ?? 0; const cq = resp.cartonQty ?? 0;
    const cbm = resp.cartonCbm ?? (resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm ? (resp.cartonLengthCm * resp.cartonWidthCm * resp.cartonHeightCm) / 1e6 : 0);
    if (unit <= 0 || cq <= 0 || cbm <= 0) continue;
    const key = `${h}|${d}|${w}|${unit}|${cbm}`; if (seen.has(key)) continue; seen.add(key);

    const fin = (spec.finishing ?? "");
    const sp: EstimateSpec = {
      heightCm: h, depthCm: d, widthCm: w, quantity: spec.quantity || 5000,
      hasHandles: /handle|ידי/i.test(fin) && !/no handle|ללא/i.test(fin),
      hasLamination: /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin),
      logoColors: Math.max(1, parseInt((spec.printing ?? "1").match(/\d+/)?.[0] ?? "1", 10)),
    };
    const actCbmU = cbm / cq;
    const est = await estimateFactoryCny(sp);

    const tag = (row.quotationNo ?? "?").padEnd(11);
    const dims = `${String(h).padStart(2)} ${String(d).padStart(2)} ${String(w).padStart(2)}`;
    const finL = `${sp.hasHandles ? "H" : "-"}${sp.hasLamination ? "L" : "-"} ${sp.logoColors}c`.padEnd(13);
    if (!est.ok) { console.log(`${tag} ${dims} ${String(sp.quantity).padStart(5)} ${finL} ¥${unit.toFixed(2)} ${actCbmU.toFixed(5)} | REFUSED: ${est.refused}`); continue; }
    const pCbmU = est.carton!.cbmPerUnit;
    const pe = pctErr(est.factoryUnitCostCny!, unit); const ce = pctErr(pCbmU, actCbmU);
    priceErrs.push(pe); cbmErrs.push(ce);
    console.log(`${tag} ${dims} ${String(sp.quantity).padStart(5)} ${finL} ¥${unit.toFixed(2)}  ${actCbmU.toFixed(5)} | ${est.factoryName!.padEnd(6)} ¥${est.factoryUnitCostCny!.toFixed(2)} (${pe >= 0 ? "+" : ""}${pe.toFixed(0)}%)  ${pCbmU.toFixed(5)} (${ce >= 0 ? "+" : ""}${ce.toFixed(0)}%)  ${est.carton!.confidence}`);
  }
  const med = (a: number[]) => { const s = a.map(Math.abs).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  console.log(`\nPRICE  |err| median=${med(priceErrs).toFixed(1)}%  (n=${priceErrs.length})`);
  console.log(`CBM    |err| median=${med(cbmErrs).toFixed(1)}%  (n=${cbmErrs.length})`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

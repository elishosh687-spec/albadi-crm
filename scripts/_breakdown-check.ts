import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";

async function main() {
  type Resp = { unitCostCny?: number };
  type Spec = { material?: string; heightCm?: number; widthCm?: number; depthCm?: number; quantity?: number; printing?: string; finishing?: string };
  const rows = await db.select().from(factoryQuoteRequests);
  const seen = new Set<string>();
  console.log("quote        finishing (real)              print | parsed  | base  +clr   +hdl   +lam   = ¥unit | 版费 | מפעל¥");
  for (const row of rows) {
    const resp = row.factoryResponse as Resp | null; const spec = row.productSpec as Spec | null;
    if (!resp || !spec) continue;
    const ok80 = /80\s*(g|克|gsm)/i.test(spec.material ?? "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "");
    const h = spec.heightCm ?? 0, w = spec.widthCm ?? 0, d = spec.depthCm ?? 0; const q = spec.quantity ?? 0;
    if (!ok80 || !h || !w || q < 3000 || q > 10000 || d <= 2 || h < 10) continue;
    const key = `${h}|${d}|${w}|${spec.printing}|${spec.finishing}|${q}`; if (seen.has(key)) continue; seen.add(key);
    const fin = spec.finishing ?? "";
    const sp: EstimateSpec = {
      heightCm: h, depthCm: d, widthCm: w, quantity: q,
      hasHandles: /handle|ידי/i.test(fin) && !/no handle|ללא/i.test(fin),
      hasLamination: /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin),
      logoColors: Math.max(1, parseInt((spec.printing ?? "1").match(/\d+/)?.[0] ?? "1", 10)),
    };
    const e = await estimateFactoryCny(sp); if (!e.ok || !e.breakdown) continue;
    const b = e.breakdown;
    const parsed = `${sp.hasHandles ? "H" : "-"}${sp.hasLamination ? "L" : "-"}/${sp.logoColors}c`;
    console.log(`${(row.quotationNo ?? "?").padEnd(11)} ${fin.slice(0, 28).padEnd(28)} ${(spec.printing ?? "").slice(0, 5).padEnd(5)} | ${parsed.padEnd(6)} | ${b.baseCny.toFixed(3)} +${b.colorCny.toFixed(3)} +${b.handleCny.toFixed(3)} +${b.lamCny.toFixed(3)} = ¥${e.factoryUnitCostCny!.toFixed(2)} | ¥${(e.plateFeeOneTimeCny ?? 0).toFixed(0)} | ¥${(resp.unitCostCny ?? 0).toFixed(2)}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

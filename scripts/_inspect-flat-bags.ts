/**
 * Inspect ALL flat-bag data points (D≤2) from both sources:
 * (a) catalog (constants.ts → DEFAULT_CONFIG.products carton specs)
 * (b) DB quotes (factory_quote_requests, 80g non-woven only)
 * Compute implied stacked thickness T (mm) for each → show why the formula breaks.
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

const area = (h: number, d: number, w: number) => 2 * h * w + 2 * h * d + w * d;
const tMm = (cbmU: number, a: number) => (cbmU / a) * 1e7;

async function main() {
  // (a) catalog
  const cat: { id: string; H: number; D: number; W: number; cbmU: number; variant: string }[] = [];
  for (const p of DEFAULT_CONFIG.products) {
    const m = p.dimensions.replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i);
    if (!m) continue;
    const H = +m[1], D = m[2] ? +m[2] : 0, W = +m[3];
    for (const [name, v] of [["+ידיות", p.withHandles], ["-ידיות", p.withoutHandles]] as const) {
      const c = v.carton; const cbmU = (c.length * c.width * c.height / 1e6) / c.qty;
      cat.push({ id: p.id, H, D, W, cbmU, variant: name });
    }
  }

  type Resp = { supplier?: string; cartonQty?: number; cartonCbm?: number; cartonLengthCm?: number; cartonWidthCm?: number; cartonHeightCm?: number };
  type Spec = { material?: string; heightCm?: number; widthCm?: number; depthCm?: number };
  const rows = await db.select().from(factoryQuoteRequests);
  const dbpts: { qn: string; H: number; D: number; W: number; cbmU: number; cq: number; sup: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const resp = row.factoryResponse as Resp | null; const spec = row.productSpec as Spec | null;
    if (!resp || !spec) continue;
    const ok80 = /80\s*(g|克|gsm)/i.test(spec.material ?? "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "");
    if (!ok80) continue;
    const H = spec.heightCm ?? 0, W = spec.widthCm ?? 0, D = spec.depthCm ?? 0;
    if (!H || !W) continue;
    const cq = resp.cartonQty ?? 0;
    const cbm = resp.cartonCbm ?? (resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm ? (resp.cartonLengthCm * resp.cartonWidthCm * resp.cartonHeightCm) / 1e6 : 0);
    if (cq <= 0 || cbm <= 0) continue;
    const cbmU = cbm / cq; const key = `${H}|${D}|${W}|${cbmU.toFixed(6)}`;
    if (seen.has(key)) continue; seen.add(key);
    dbpts.push({ qn: row.quotationNo ?? "?", H, D, W, cbmU, cq, sup: (resp.supplier ?? "?").slice(0, 10) });
  }

  console.log("=== FLAT BAGS (D ≤ 2) ===\n");
  console.log("--- CATALOG (constants.ts) ---");
  console.log("id    variant      H  D  W   area    T(mm)    | regular range 0.77–0.92mm");
  const flatCat = cat.filter(p => p.D <= 2);
  for (const p of flatCat) {
    const a = area(p.H, p.D, p.W); const t = tMm(p.cbmU, a);
    console.log(`${p.id.padEnd(5)} ${p.variant.padEnd(10)} ${String(p.H).padStart(2)} ${String(p.D).padStart(2)} ${String(p.W).padStart(2)}  ${String(a).padStart(5)}   ${t.toFixed(2).padStart(5)}  ${t < 0.75 || t > 0.95 ? "⚠️" : "✓"}`);
  }
  console.log(`\nflat catalog n=${flatCat.length}\n`);

  console.log("--- DB QUOTES (80g non-woven) ---");
  console.log("quote        H  D  W   area    T(mm)    supplier    q/ctn");
  const flatDb = dbpts.filter(p => p.D <= 2);
  for (const p of flatDb) {
    const a = area(p.H, p.D, p.W); const t = tMm(p.cbmU, a);
    console.log(`${p.qn.padEnd(11)} ${String(p.H).padStart(2)} ${String(p.D).padStart(2)} ${String(p.W).padStart(2)}  ${String(a).padStart(5)}   ${t.toFixed(2).padStart(5)}  ${p.sup.padEnd(10)}  ${p.cq}`);
  }
  console.log(`\nflat DB n=${flatDb.length}\n`);

  // combined stats
  const allFlatT = [...flatCat.map(p => tMm(p.cbmU, area(p.H, p.D, p.W))), ...flatDb.map(p => tMm(p.cbmU, area(p.H, p.D, p.W)))];
  allFlatT.sort((a, b) => a - b);
  console.log(`=== COMBINED FLAT BAGS (catalog + DB) ===`);
  console.log(`n=${allFlatT.length}  T range: ${allFlatT[0].toFixed(2)} – ${allFlatT[allFlatT.length - 1].toFixed(2)} mm  (×${(allFlatT[allFlatT.length - 1] / allFlatT[0]).toFixed(1)} spread)`);
  console.log(`median T = ${allFlatT[Math.floor(allFlatT.length / 2)].toFixed(2)} mm`);
  console.log(`\nFor comparison: gusseted (D>2) bags cluster tightly at 0.77–0.92 mm (×1.2 spread)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

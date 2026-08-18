/**
 * Verify the shipped carton model reproduces the workflow-verified figures.
 * Reuses the SAME functions the app uses (estimator-fit + estimator).
 * Run: DATABASE_URL="$(neonctl …)" npx tsx scripts/_verify-carton.ts
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { catalogCartonPts, fitCartonT, looCartonT, isGussetedNormal, impliedTmm, type CartonPt } from "@/lib/factory/server/estimator-fit";
import { estimateFactoryCny } from "@/lib/factory/estimator";
import { calculateQuote } from "@/lib/factory/calculator/engine";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import type { Product, QuoteFormData } from "@/lib/factory/calculator/types";

const area = (h: number, d: number, w: number) => 2 * h * w + 2 * h * d + w * d;

async function dbCartonPts(): Promise<CartonPt[]> {
  type Resp = { supplier?: string; cartonQty?: number; cartonCbm?: number; cartonLengthCm?: number; cartonWidthCm?: number; cartonHeightCm?: number };
  type Spec = { material?: string; heightCm?: number; widthCm?: number; depthCm?: number };
  const rows = await db.select().from(factoryQuoteRequests);
  const out: CartonPt[] = []; const seen = new Set<string>();
  for (const row of rows) {
    const resp = row.factoryResponse as Resp | null; const spec = row.productSpec as Spec | null;
    if (!resp || !spec) continue;
    const ok80 = /80\s*(g|克|gsm)/i.test(spec.material ?? "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "");
    const h = spec.heightCm ?? 0, w = spec.widthCm ?? 0, d = spec.depthCm ?? 0;
    if (!ok80 || !h || !w) continue;
    const cq = resp.cartonQty ?? 0;
    const cbm = resp.cartonCbm ?? (resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm ? (resp.cartonLengthCm * resp.cartonWidthCm * resp.cartonHeightCm) / 1e6 : 0);
    if (cq <= 0 || cbm <= 0) continue;
    const a = area(h, d, w); const cbmPerUnit = cbm / cq; const t = (cbmPerUnit / a) * 1e7;
    const key = `${h}|${d}|${w}|${cbmPerUnit.toFixed(6)}`;
    if (t >= 0.3 && t <= 1.4 && !seen.has(key)) { seen.add(key); out.push({ factory: "db", area: a, depth: d, height: h, cbmPerUnit, src: "db" }); }
  }
  return out;
}

async function main() {
  const cat = catalogCartonPts(); const dbp = await dbCartonPts(); const all = [...cat, ...dbp];
  const g = all.filter((p) => isGussetedNormal(p));
  const fit = fitCartonT(all); const loo = looCartonT(all);
  console.log("=== CARTON MODEL VERIFICATION ===");
  console.log(`points: catalog ${cat.length} + DB ${dbp.length} = ${all.length}  | gusseted in-envelope = ${g.length}`);
  console.log(`fitted T(gusseted) = ${fit.tMmGusseted}mm  per-factory: ${JSON.stringify(fit.perFactoryTMm)}`);
  console.log(`LOO CBM/unit: median=${loo.median.toFixed(1)}% p90=${loo.p90.toFixed(1)}% max=${loo.max.toFixed(1)}% (n=${g.length})`);
  console.log(`GATE median<=10%: ${loo.median <= 10 ? "PASS ✅" : "FAIL ❌"}`);
  const flat = all.filter((p) => !isGussetedNormal(p));
  console.log(`manual-only (flat/tray/out-of-envelope): ${flat.length} — ${flat.slice(0, 5).map((p) => `H${p.height}D${p.depth}(t=${impliedTmm(p).toFixed(2)})`).join(", ")}`);

  console.log("\n=== predictCarton via estimateFactoryCny (live coeffs) ===");
  for (const s of [
    { tag: "gusseted (Mandy-ish)", widthCm: 40, heightCm: 35, depthCm: 10, quantity: 5000, hasHandles: true, hasLamination: false, logoColors: 1 },
    { tag: "flat D=0", widthCm: 45, heightCm: 60, depthCm: 0, quantity: 5000, hasHandles: true, hasLamination: false, logoColors: 1 },
    { tag: "tray H<10", widthCm: 40, heightCm: 5, depthCm: 40, quantity: 5000, hasHandles: true, hasLamination: false, logoColors: 1 },
  ]) {
    const { tag, ...spec } = s;
    const r = await estimateFactoryCny(spec);
    if (!r.ok) { console.log(`  ${tag}: refused — ${r.refused}`); continue; }
    const c = r.carton!;
    console.log(`  ${tag}: ${r.factoryName} | carton ${c.lengthCm}×${c.widthCm}×${c.heightCm} ${c.qty}/ctn · CBM/u ${c.cbmPerUnit.toFixed(5)} · conf=${c.confidence}`);
  }

  console.log("\n=== Phase B cross-check: predictCarton → calculateQuote totalCbm ≈ cbmPerUnit × qty ===");
  const spec = { widthCm: 40, heightCm: 35, depthCm: 10, quantity: 5000, hasHandles: true, hasLamination: false, logoColors: 1 };
  const est = await estimateFactoryCny(spec);
  if (est.ok && est.carton) {
    const cc = est.carton; const cny = est.factoryUnitCostCny!;
    const flat = { "1000": cny, "3000": cny, "5000": cny, "10000": cny };
    const custom: Product = {
      id: "estimate", dimensions: `H35*D10*W40`, description: "x", sortOrder: 9999, laminationColorPlateFee: 0,
      withHandles: { prices: flat, carton: { qty: cc.qty, weight: cc.weightKg, length: cc.lengthCm, width: cc.widthCm, height: cc.heightCm } },
      withoutHandles: { prices: flat, carton: { qty: cc.qty, weight: cc.weightKg, length: cc.lengthCm, width: cc.widthCm, height: cc.heightCm } },
    };
    const cfg = { ...DEFAULT_CONFIG, products: [...DEFAULT_CONFIG.products, custom] };
    const form: QuoteFormData = { productId: "estimate", quantityTierId: "", quantityOverride: 5000, hasHandles: false, logoColors: 1, shippingOptionId: "s2", selectedFeatureIds: [], moldsCostCny: 0 };
    const q = calculateQuote(form, cfg);
    const expected = cc.cbmPerUnit * 5000;
    const drift = q ? Math.abs(q.totalCbm - expected) / expected * 100 : NaN;
    console.log(`  engine totalCbm=${q?.totalCbm.toFixed(3)} | expected cbmPerUnit×5000=${expected.toFixed(3)} | drift=${drift.toFixed(1)}% (carton-rounding) ${drift < 6 ? "✅" : "⚠️"}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";

async function main() {
  const config = await getFactoryConfig({ fresh: true });
  const shipId = config.shippingOptions.find((s) => s.type === "sea" && s.enabled)?.id
    ?? config.shippingOptions.find((s) => s.enabled)?.id ?? "s1";
  console.log("sea shipping option:", shipId, "| usdToIls:", config.usdToIls, "| usdToCny:", config.usdToCny);

  const base: Omit<EstimateSpec, "quantity"> = {
    widthCm: 30, heightCm: 36, depthCm: 15,
    hasHandles: true, hasLamination: true, logoColors: 4,
  };

  // Anchor the factory unit cost at the highest in-range tier (10000).
  const anchorQtys = [5000, 10000];
  for (const q of anchorQtys) {
    const est = await estimateFactoryCny({ ...base, quantity: q });
    if (!est.ok) { console.log(`\n### qty ${q}: REFUSED — ${est.refused}`); continue; }
    const pricing = priceFactoryQuote({
      factoryUnitCostCny: est.factoryUnitCostCny!,
      quantity: q,
      shippingOptionId: shipId,
      cartonSpec: est.carton ? { qty: est.carton.qty, weightKg: est.carton.weightKg, lengthCm: est.carton.lengthCm, widthCm: est.carton.widthCm, heightCm: est.carton.heightCm } : {},
      moldsCostCny: 0,
      logoColors: 4,
      platePerColorCny: est.platePerColorCny ?? 0,
    }, config);
    report(q, est, pricing);
  }

  // 20000 — out of the estimator's fitted range. Reuse the 10000-tier factory
  // unit CNY + carton (economies of scale flatten past 10k), price shipping at 20k.
  const anchor = await estimateFactoryCny({ ...base, quantity: 10000 });
  if (anchor.ok) {
    const q = 20000;
    const pricing = priceFactoryQuote({
      factoryUnitCostCny: anchor.factoryUnitCostCny!,
      quantity: q,
      shippingOptionId: shipId,
      cartonSpec: anchor.carton ? { qty: anchor.carton.qty, weightKg: anchor.carton.weightKg, lengthCm: anchor.carton.lengthCm, widthCm: anchor.carton.widthCm, heightCm: anchor.carton.heightCm } : {},
      moldsCostCny: 0,
      logoColors: 4,
      platePerColorCny: anchor.platePerColorCny ?? 0,
    }, config);
    console.log(`\n### qty ${q} (EXTRAPOLATED — factory CNY from 10k tier, shipping at 20k):`);
    report(q, anchor, pricing);
  }
}

function report(q: number, est: any, p: any) {
  console.log(`\n### qty ${q.toLocaleString()} — factory: ${est.factoryName} (${est.confidence}, carton ${est.carton?.confidence})`);
  console.log(`  factory unit CNY: ¥${est.factoryUnitCostCny?.toFixed(3)} | plate/colour ¥${est.platePerColorCny ?? 0} × 4`);
  console.log(`  ILS unit selling:  ₪${p.unitSellingPrice?.toFixed(3)}`);
  console.log(`    ↳ shipping/unit:  ₪${p.unitShipping?.toFixed(3)}`);
  console.log(`  total order:       ₪${p.totalSellingPrice?.toLocaleString("he-IL", { maximumFractionDigits: 0 })}  (+ molds/plate ₪${(p.moldsTotalSellingPriceIls ?? 0).toFixed(0)})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

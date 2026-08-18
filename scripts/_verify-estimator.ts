/** Sanity-check estimateFactoryCny against known real quotes (baked default coeffs, no DB). */
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";
import { DEFAULT_ESTIMATOR_COEFFS } from "@/lib/factory/estimator-config";

const cases: { label: string; spec: EstimateSpec; expect: string }[] = [
  { label: "Mandy lam 3c 5000 (real ¥1.08)", spec: { widthCm: 35, heightCm: 29, depthCm: 25, quantity: 5000, hasHandles: true, hasLamination: true, logoColors: 3 }, expect: "Mandy ~1.0" },
  { label: "亚森 non-lam 2c 3000 (real ¥1.5)", spec: { widthCm: 50, heightCm: 45, depthCm: 10, quantity: 3000, hasHandles: true, hasLamination: false, logoColors: 2 }, expect: "亚森/Mandy ~1.4" },
  { label: "non-lam 2c 5000 mid (real ¥0.8)", spec: { widthCm: 30, heightCm: 30, depthCm: 17, quantity: 5000, hasHandles: true, hasLamination: false, logoColors: 2 }, expect: "cheapest ~0.79" },
  { label: "lamination → must be Mandy", spec: { widthCm: 40, heightCm: 35, depthCm: 20, quantity: 5000, hasHandles: true, hasLamination: true, logoColors: 3 }, expect: "Mandy" },
  { label: "tiny bag H15xW45 → refuse", spec: { widthCm: 45, heightCm: 15, depthCm: 0, quantity: 10000, hasHandles: true, hasLamination: false, logoColors: 2 }, expect: "refused (out of range)" },
  { label: "qty 20000 → refuse", spec: { widthCm: 40, heightCm: 35, depthCm: 10, quantity: 20000, hasHandles: true, hasLamination: false, logoColors: 1 }, expect: "refused (>maxQty)" },
];

async function main() {
  for (const c of cases) {
    const r = await estimateFactoryCny(c.spec, DEFAULT_ESTIMATOR_COEFFS);
    if (r.ok) console.log(`✓ ${c.label}\n   → ${r.factoryName} ¥${r.factoryUnitCostCny} (conf ${r.confidence}) plate¥${r.plateFeeOneTimeCny} | candidates: ${r.candidates?.map((x) => `${x.factory}:${x.unitCny}${x.inRange ? "" : "*"}`).join(" ")}\n   expect: ${c.expect}`);
    else console.log(`⊘ ${c.label}\n   → REFUSED: ${r.refused}\n   expect: ${c.expect}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

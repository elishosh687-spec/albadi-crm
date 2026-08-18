/**
 * Reproduce Eli's bug — call the estimator with colors=1, 2, 3 (same
 * everything else) and print what the API returns.
 *
 * Run: DATABASE_URL=... npx tsx scripts/_test-estimator-colors.ts
 */
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";

async function one(spec: EstimateSpec, label: string) {
  const r = await estimateFactoryCny(spec);
  if (!r.ok) {
    console.log(`${label}: REFUSED — ${r.refused}`);
    return;
  }
  console.log(
    `${label}: factory=${r.factoryName} unit=¥${r.factoryUnitCostCny?.toFixed(3)} ` +
      `plateOneTime=¥${r.plateFeeOneTimeCny?.toFixed(2)} ` +
      `bd.color=¥${r.breakdown?.colorCny?.toFixed(3)} ` +
      `bd.base=¥${r.breakdown?.baseCny?.toFixed(3)} ` +
      `bd.handle=¥${r.breakdown?.handleCny?.toFixed(3)}`
  );
}

async function main() {
  const baseSpec: Omit<EstimateSpec, "logoColors" | "hasLamination"> = {
    widthCm: 23,
    heightCm: 28,
    depthCm: 10,
    quantity: 3000,
    hasHandles: true,
  };

  console.log("\n=== WITHOUT lamination ===");
  for (const colors of [1, 2, 3]) {
    await one({ ...baseSpec, logoColors: colors, hasLamination: false }, `colors=${colors} lam=OFF`);
  }

  console.log("\n=== WITH lamination ===");
  for (const colors of [1, 2, 3]) {
    await one({ ...baseSpec, logoColors: colors, hasLamination: true }, `colors=${colors} lam=ON `);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

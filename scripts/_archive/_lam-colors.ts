import { estimateFactoryCny } from "@/lib/factory/estimator";
async function main() {
  for (const colors of [1, 3, 5]) {
    const e = await estimateFactoryCny({ heightCm: 30, depthCm: 25, widthCm: 30, quantity: 5000, hasHandles: true, hasLamination: true, logoColors: colors });
    if (!e.ok) { console.log(`${colors}c: refused ${e.refused}`); continue; }
    const platePerUnit = (e.plateFeeOneTimeCny ?? 0) / 5000;
    const effective = e.factoryUnitCostCny! + platePerUnit;
    console.log(`${colors} צבעים: יח׳ ¥${e.factoryUnitCostCny!.toFixed(2)} + 版费 ¥${(e.plateFeeOneTimeCny??0).toFixed(0)} חד-פעמי (¥${platePerUnit.toFixed(3)}/יח׳) = אפקטיבי ¥${effective.toFixed(3)}/יח׳`);
  }
  console.log("\nreasoning (5 colors):");
  const e5 = await estimateFactoryCny({ heightCm: 30, depthCm: 25, widthCm: 30, quantity: 5000, hasHandles: true, hasLamination: true, logoColors: 5 });
  if (e5.ok) e5.reasoning!.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

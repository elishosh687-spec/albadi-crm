/**
 * Verify the 2026-09-10 lamination/colour change against the live config:
 *  - resolveLamination: explicit choice wins, default from 4 colours.
 *  - unlaminated 4+ colours no longer price like 1 colour (catalog) or 3 (estimator).
 */
import "dotenv/config";
import { resolveLamination } from "../lib/factory/calculator/lamination";
import { calculateQuoteByCodes, resolveQuantityTier } from "../lib/factory/calculator";
import { estimateFactoryCny } from "../lib/factory/estimator";

async function main() {
  console.log("resolveLamination:");
  for (const [chosen, c] of [[null, 3], [null, 4], [false, 4], [true, 2], [undefined, 6]] as const) {
    console.log(`  chosen=${String(chosen).padEnd(9)} colours=${c} → ${resolveLamination(chosen, c)}`);
  }

  const tier = resolveQuantityTier(5000);
  console.log("\ncatalog p2 30×10×30 · 5,000 · handles · NO lamination · sea:");
  let prev = 0;
  for (const colors of [1, 2, 3, 4, 5]) {
    const out = await calculateQuoteByCodes({
      productId: "p2", quantityTierId: tier.id, hasHandles: true,
      logoColors: colors, hasLamination: false, shippingOptionId: "s2",
    });
    const r = out!.result;
    const flag = colors > 1 && r.logoAddonCny <= prev ? "  ⚠️ not above previous" : "";
    console.log(`  ${colors} colours: add-on ¥${r.logoAddonCny.toFixed(2)} → ₪${r.sellingPricePerUnitIls.toFixed(2)}/bag${flag}`);
    prev = r.logoAddonCny;
  }

  console.log("\nestimator 35×10×40 · 5,000 · handles · NO lamination:");
  prev = 0;
  for (const colors of [1, 2, 3, 4, 5]) {
    const e = await estimateFactoryCny({
      widthCm: 35, heightCm: 40, depthCm: 10, quantity: 5000,
      hasHandles: true, hasLamination: false, logoColors: colors,
    });
    const c = e.breakdown?.colorCny ?? 0;
    const flag = colors > 1 && c <= prev ? "  ⚠️ not above previous" : "";
    console.log(`  ${colors} colours: colour ¥${c.toFixed(3)} · unit ¥${e.factoryUnitCostCny?.toFixed(3)} (${e.factoryName})${flag}`);
    prev = c;
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

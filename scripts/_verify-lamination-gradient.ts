/**
 * Read-only: for every catalog product, compute the CUSTOMER total (40% margin)
 * for a laminated bag at 3000 vs 5000 units and flag any case where the
 * 5000-unit total is LOWER than the 3000-unit total ("the big drop").
 * Calls the PURE pricing engine with DEFAULT_CONFIG (no DB) — same math the
 * website/widget hit.
 */
import { calculateQuote } from "@/lib/factory/calculator/engine";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

function quote(productId: string, hasHandles: boolean, quantity: number, ship: string) {
  return calculateQuote(
    {
      productId,
      quantityTierId: "",
      quantityOverride: quantity,
      hasHandles,
      logoColors: 1,
      selectedFeatureIds: ["f1"], // lamination on
      shippingOptionId: ship,
      moldsCostCny: 0,
    } as any,
    DEFAULT_CONFIG
  );
}

function main() {
  const SHIP = "s1"; // express/air default
  const rows: string[] = [];
  let inversions = 0;

  for (const p of DEFAULT_CONFIG.products) {
    for (const hasHandles of [true, false]) {
      const lam = hasHandles ? p.withHandles.laminationPrices : p.withoutHandles.laminationPrices;
      if (!lam || lam["3000"] == null || lam["5000"] == null) continue;

      const q3 = quote(p.id, hasHandles, 3000, SHIP);
      const q5 = quote(p.id, hasHandles, 5000, SHIP);
      if (!q3 || !q5) continue;

      const t3 = q3.totalOrderPriceIls, t5 = q5.totalOrderPriceIls;
      const drop = t5 < t3;
      if (drop) inversions++;
      rows.push(
        `${drop ? "❌ DROP" : "✓     "}  ${p.id.padEnd(4)} ${p.dimensions.padEnd(12)} ${hasHandles ? "ידיות" : "ללא  "} | ` +
        `lamCNY 3k=${lam["3000"]} 5k=${lam["5000"]} | ` +
        `unit 3k=₪${q3.sellingPricePerUnitIls.toFixed(2)} 5k=₪${q5.sellingPricePerUnitIls.toFixed(2)} | ` +
        `TOTAL 3k=₪${t3.toLocaleString()} 5k=₪${t5.toLocaleString()} (Δ=${(t5 - t3).toLocaleString()})`
      );
    }
  }

  console.log(rows.join("\n"));
  console.log(`\n${inversions} inversion(s) where total(5000) < total(3000).`);
}

main();

/**
 * Sanity-check the mold split refactor:
 *   1. Per-unit price (bag) excludes the one-time mold.
 *   2. Grand total = bag_total + mold_one_time.
 *   3. Profit math is consistent (mold profit added separately).
 *
 * Compares the new behavior at margin=40% / qty=5000 / factory=1¥ / mold=2000¥
 * to the analytical expectation.
 */
import "dotenv/config";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import type { FactoryPricingConfig } from "@/lib/factory/types";

const cfg: FactoryPricingConfig = {
  usdToIls: 3.7,
  usdToCny: 7,
  defaultProfitMargin: 40,
  shippingOptions: [
    {
      id: "s2",
      name: "ים",
      type: "sea",
      enabled: true,
      seaRate: 100,
    } as never,
  ],
};

const res = priceFactoryQuote(
  {
    quantity: 5000,
    factoryUnitCostCny: 1,
    moldsCostCny: 2000,
    shippingOptionId: "s2",
    cartonSpec: { qty: 250, weightKg: 15, cbm: 0.1 },
    profitMarginOverride: 40,
  },
  cfg
);

const cnyToIls = cfg.usdToIls / cfg.usdToCny;
const expectedUnitCostBagOnly = 1 * cnyToIls;            // ≈ 0.529
const expectedUnitSelling = expectedUnitCostBagOnly / 0.6;
const expectedMoldCostIls = 2000 * cnyToIls;             // ≈ 1057
const expectedMoldSelling = expectedMoldCostIls / 0.6;

console.log(JSON.stringify(res, null, 2));
console.log("\n--- Sanity checks ---");
console.log(`unitCost (should be bag-only ≈ ${expectedUnitCostBagOnly.toFixed(3)}):`, res.unitCost);
console.log(`unitSellingPrice (bag-only, no shipping ≈ ${expectedUnitSelling.toFixed(3)} + shipping):`, res.unitSellingPrice);
console.log(`moldsTotalCostIls (≈ ${expectedMoldCostIls.toFixed(2)}):`, res.moldsTotalCostIls);
console.log(`moldsTotalSellingPriceIls (≈ ${expectedMoldSelling.toFixed(2)}):`, res.moldsTotalSellingPriceIls);
console.log(`totalSellingPrice should equal bagsTotal + moldSelling: `,
  (res.unitSellingPrice * 5000 + res.moldsTotalSellingPriceIls).toFixed(2),
  "vs reported:", res.totalSellingPrice);

/**
 * Scratch: verify the public configurator quote + customer-safe breakdown.
 * Runs against the LIVE Neon factory config (read-only). Asserts the breakdown
 * parts reconcile to unitPriceIls and prints a few sample quotes.
 *
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/_verify-configurator-breakdown.ts
 */
import { buildConfiguratorQuote } from "@/lib/configurator/quote-response";

const CASES = [
  { productId: "p1", quantity: 3000, hasHandles: true, logoColors: 1, hasLamination: false, shippingOptionId: "s2" },
  { productId: "p1", quantity: 5000, hasHandles: true, logoColors: 2, hasLamination: false, shippingOptionId: "s1" },
  { productId: "p1", quantity: 3000, hasHandles: true, logoColors: 2, hasLamination: true, shippingOptionId: "s2" },
  { productId: "p3", quantity: 10000, hasHandles: false, logoColors: 1, hasLamination: false, shippingOptionId: "s2" },
];

async function main() {
  for (const c of CASES) {
    const q = await buildConfiguratorQuote(c);
    if (!q) {
      console.log("❌ no quote for", c);
      continue;
    }
    const b = q.breakdown;
    const sum = b.productIls + b.handlesIls + b.laminationIls + b.logoColorsIls;
    const reconciles = Math.abs(sum - q.unitPriceIls) < 0.01;
    console.log("────────────────────────────────────────");
    console.log(
      `${q.productId} ${q.quantity} ${c.hasHandles ? "handles" : "no-handles"} ` +
        `${c.hasLamination ? "lam" : "no-lam"} ${q.logoColors}c ${q.shippingOptionName}`
    );
    console.log(
      `  unit ₪${q.unitPriceIls}  total ₪${q.totalOrderIls}  (margin ${q.profitMargin}%, delivery ~${q.shippingDeliveryDays}d)`
    );
    console.log(
      `  breakdown: base+ship ₪${b.productIls}  handles ₪${b.handlesIls}  lam ₪${b.laminationIls}  logo ₪${b.logoColorsIls}`
    );
    console.log(`  Σparts ₪${sum.toFixed(2)} ${reconciles ? "✅ == unit" : "❌ != unit ₪" + q.unitPriceIls}`);
    if (q.altShipping) {
      console.log(`  alt: ${q.altShipping.shippingOptionName} unit ₪${q.altShipping.unitPriceIls} total ₪${q.altShipping.totalOrderIls}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { writeFileSync } from "fs";
import { renderCustomerQuotePdf } from "@/lib/factory/pdf";
import { computeQuoteBreakdown } from "@/lib/factory/calculator";

async function main() {
  // Spec matching product p2 (30×10×30) — same as the reference screenshot.
  const spec = {
    description: "שקיות אריזה",
    material: "80g non-woven",
    widthCm: 30,
    heightCm: 30,
    depthCm: 10,
    quantity: 10000,
    printing: "2 colors",
    finishing: "With handles / Not laminated",
  };
  const breakdown = computeQuoteBreakdown({
    widthCm: spec.widthCm,
    heightCm: spec.heightCm,
    depthCm: spec.depthCm,
    quantity: spec.quantity,
    hasHandles: true,
    logoColors: 2,
    hasLamination: false,
    shippingOptionId: "s2",
  });
  console.log("breakdown:", JSON.stringify(breakdown, null, 2));

  const buf = await renderCustomerQuotePdf({
    customerName: "Sharbel Elias",
    quotationNo: "TEST123",
    spec,
    breakdown,
    pricing: {
      quantity: 10000,
      currency: "ILS",
      unitCost: 0.5,
      unitShipping: 0.05,
      unitProfit: 0.34,
      unitSellingPrice: 0.89,
      totalCost: 5500,
      totalShipping: 500,
      totalProfit: 2900,
      totalSellingPrice: 8900,
      totalCartons: 40,
      totalWeightKg: 320,
      totalCbm: 2.5,
      profitMarginPct: 40,
      shippingOptionId: "s2",
      shippingOptionName: "ים — סטנדרט",
    },
  });
  writeFileSync("test-output.pdf", buf);
  console.log(`OK: ${buf.length} bytes → test-output.pdf`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

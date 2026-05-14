import { writeFileSync } from "fs";
import { renderCustomerQuotePdf } from "@/lib/factory/pdf";

async function main() {
  const buf = await renderCustomerQuotePdf({
    customerName: "Sharbel Elias",
    quotationNo: "TEST123",
    spec: {
      description: "שקיות אריזה",
      material: "80g non-woven",
      widthCm: 20,
      heightCm: 20,
      depthCm: 20,
      quantity: 29000,
      printing: "1 color",
      finishing: "With handles / Laminated",
    },
    pricing: {
      quantity: 29000,
      currency: "ILS",
      unitCost: 0.4,
      unitShipping: 0.05,
      unitProfit: 0.21,
      unitSellingPrice: 0.66,
      totalCost: 11600,
      totalShipping: 1450,
      totalProfit: 6090,
      totalSellingPrice: 19140,
      totalCartons: 58,
      totalWeightKg: 551,
      totalCbm: 4.64,
      profitMarginPct: 40,
      shippingOptionId: "sea-standard",
      shippingOptionName: "ים — סטנדרט",
    },
  });
  writeFileSync("test-output.pdf", buf);
  console.log(`OK: ${buf.length} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

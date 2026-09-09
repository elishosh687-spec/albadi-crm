import { estimateFactoryCny } from "@/lib/factory/estimator";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import { renderCustomerQuotePdf } from "@/lib/factory/pdf";
import type { FactoryProductSpec } from "@/lib/factory/types";
import { writeFileSync } from "fs";
async function main() {
  const spec = { heightCm: 35, depthCm: 10, widthCm: 40, quantity: 5000, hasHandles: true, hasLamination: true, logoColors: 3 };
  const est = await estimateFactoryCny(spec);
  if (!est.ok) { console.log("refused", est.refused); return; }
  const config = await getFactoryConfig({ fresh: true });
  const shipId = config.shippingOptions.find(s => s.enabled)?.id ?? null;
  const pricing = priceFactoryQuote({ factoryUnitCostCny: est.factoryUnitCostCny!, quantity: 5000, shippingOptionId: shipId, cartonSpec: { qty: est.carton!.qty, weightKg: est.carton!.weightKg, lengthCm: est.carton!.lengthCm, widthCm: est.carton!.widthCm, heightCm: est.carton!.heightCm }, moldsCostCny: est.plateFeeOneTimeCny ?? 0 }, config);
  const productSpec: FactoryProductSpec = { description: "שקית אל-ארוג 80 גרם", material: "80g non-woven", widthCm: 40, heightCm: 35, depthCm: 10, quantity: 5000, printing: "3 color(s)", finishing: "With handles / Laminated" };
  console.log(`estimate: ${est.factoryName} ¥${est.factoryUnitCostCny} | sell ₪${pricing.unitSellingPrice.toFixed(2)}/u total ₪${pricing.totalSellingPrice.toFixed(0)} | molds(版费) ₪${(pricing.moldsTotalSellingPriceIls ?? 0).toFixed(0)}`);
  const buf = await renderCustomerQuotePdf({ customerName: "ישראל ישראלי", spec: productSpec, pricing, breakdown: null, isEstimate: true });
  writeFileSync("/tmp/estimate.pdf", buf);
  console.log("wrote /tmp/estimate.pdf", buf.length, "bytes");
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});

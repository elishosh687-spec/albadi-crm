/**
 * Mimic the full /api/factory/estimate route inline (without HTTP) — call
 * estimateFactoryCny + calculateQuote like the route does, with the user's
 * exact UI inputs. Print per-color totals to see what UI should display.
 *
 * DATABASE_URL=… npx tsx scripts/_test-estimator-api.ts
 */
import { calculateQuote } from "@/lib/factory/calculator/engine";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { getFactoryConfig } from "@/lib/factory/config";
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";
import type { AppConfig, Product, QuoteFormData } from "@/lib/factory/calculator/types";

function buildConfig(dbConfig: Awaited<ReturnType<typeof getFactoryConfig>>, custom: Product): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    products: [...DEFAULT_CONFIG.products, custom],
    seaCarriers: dbConfig.seaCarriers ?? DEFAULT_CONFIG.seaCarriers,
    activeSeaCarrierId: dbConfig.activeSeaCarrierId ?? DEFAULT_CONFIG.activeSeaCarrierId,
    assumedShipmentCbm: dbConfig.assumedShipmentCbm ?? DEFAULT_CONFIG.assumedShipmentCbm,
    exchangeRates: { usdToIls: dbConfig.usdToIls, usdToCny: dbConfig.usdToCny },
    adminSettings: {
      globalProfitMargin: dbConfig.defaultProfitMargin,
      profitMarginByQuantity: dbConfig.profitMarginByQuantity ?? {},
    },
    shippingOptions: DEFAULT_CONFIG.shippingOptions.map((s) => {
      const dbOpt = dbConfig.shippingOptions.find((d) => d.type === s.type && d.enabled);
      return dbOpt ? { ...s, enabled: dbOpt.enabled, seaRate: dbOpt.seaRate ?? s.seaRate, airRates: dbOpt.airRates ?? s.airRates } : s;
    }),
  };
}

async function run(spec: EstimateSpec, userMoldsCny: number, shipping: string, label: string) {
  const est = await estimateFactoryCny(spec);
  if (!est.ok) {
    console.log(`${label}: REFUSED — ${est.refused}`);
    return;
  }
  const dbConfig = await getFactoryConfig({ fresh: true });
  const cny = est.factoryUnitCostCny!;
  const c = est.carton ?? { qty: 250, weightKg: 5, lengthCm: 40, widthCm: 30, heightCm: 40 };
  const flat = { "1000": cny, "3000": cny, "5000": cny, "10000": cny };
  const lamFlat: Record<string, number> = spec.hasLamination ? { ...flat } : {};
  const custom: Product = {
    id: "estimate", dimensions: `H${spec.heightCm}*D${spec.depthCm}*W${spec.widthCm}`,
    description: `אומדן ${est.factoryName}`, sortOrder: 9999,
    laminationColorPlateFee: est.platePerColorCny ?? 0,
    withHandles: { prices: flat, carton: { qty: c.qty, weight: c.weightKg, length: c.lengthCm, width: c.widthCm, height: c.heightCm }, laminationPrices: lamFlat },
    withoutHandles: { prices: flat, carton: { qty: c.qty, weight: c.weightKg, length: c.lengthCm, width: c.widthCm, height: c.heightCm }, laminationPrices: lamFlat },
  };
  const cfg = buildConfig(dbConfig, custom);
  const form: QuoteFormData = {
    productId: "estimate", quantityTierId: "", quantityOverride: spec.quantity,
    hasHandles: false,
    logoColors: spec.hasLamination ? spec.logoColors : 1,
    shippingOptionId: shipping,
    selectedFeatureIds: spec.hasLamination ? ["f1"] : [],
    moldsCostCny: userMoldsCny,
  };
  const result = calculateQuote(form, cfg);
  if (!result) {
    console.log(`${label}: calculateQuote returned null`);
    return;
  }
  console.log(
    `${label}: unit=₪${result.sellingPricePerUnitIls.toFixed(2)} ` +
      `plateCny=¥${result.plateFeeCny.toFixed(3)}/יח׳ (auto, pass-through) ` +
      `molds=¥${userMoldsCny} =₪${result.moldsTotalSellingPriceIls.toFixed(2)} (manual, pass-through) ` +
      `total=₪${result.totalOrderPriceIls.toFixed(2)}`
  );
}

async function main() {
  console.log("usdToCny / usdToIls / FX:");
  const cfg = await getFactoryConfig({ fresh: true });
  console.log(`  usdToCny=${cfg.usdToCny}  usdToIls=${cfg.usdToIls}  cnyToIls=${(cfg.usdToIls / cfg.usdToCny).toFixed(4)}`);

  const baseSpec: Omit<EstimateSpec, "logoColors" | "hasLamination"> = {
    widthCm: 23, heightCm: 28, depthCm: 10, quantity: 3000, hasHandles: true,
  };

  console.log("\n=== WITHOUT lamination, userMolds=¥4000, sea ===");
  for (const colors of [1, 2, 3]) {
    await run({ ...baseSpec, logoColors: colors, hasLamination: false }, 4000, "s2", `colors=${colors} lam=OFF`);
  }

  console.log("\n=== WITH lamination, userMolds=¥4000, sea ===");
  for (const colors of [1, 2, 3]) {
    await run({ ...baseSpec, logoColors: colors, hasLamination: true }, 4000, "s2", `colors=${colors} lam=ON `);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });

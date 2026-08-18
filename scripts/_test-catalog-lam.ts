/**
 * Verify the regular catalog calculator now treats lamination plate fee as
 * pass-through (no margin). Compare WITHOUT and WITH lamination on p2 5000.
 *
 * DATABASE_URL=… npx tsx scripts/_test-catalog-lam.ts
 */
import { calculateQuote } from "@/lib/factory/calculator/engine";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { getFactoryConfig } from "@/lib/factory/config";
import type { AppConfig, QuoteFormData } from "@/lib/factory/calculator/types";

async function main() {
  const dbConfig = await getFactoryConfig({ fresh: true });
  const cfg: AppConfig = {
    ...DEFAULT_CONFIG,
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

  console.log(`FX: cny→ils ${(dbConfig.usdToIls / dbConfig.usdToCny).toFixed(4)}\n`);

  const baseForm: QuoteFormData = {
    productId: "p2",
    quantityTierId: "",
    quantityOverride: 5000,
    hasHandles: true,
    logoColors: 3,
    shippingOptionId: "s2",
    selectedFeatureIds: [],
    moldsCostCny: 0,
  };

  for (const lam of [false, true]) {
    const form = { ...baseForm, selectedFeatureIds: lam ? ["f1"] : [] };
    const r = calculateQuote(form, cfg);
    if (!r) { console.log(`lam=${lam}: null`); continue; }
    const plateCny = r.plateFeeCny ?? 0;
    const plateIls = (plateCny / dbConfig.usdToCny) * dbConfig.usdToIls;
    console.log(
      `p2/5000/3-colors/handles, lam=${lam ? "ON " : "OFF"}: ` +
        `unit=₪${r.sellingPricePerUnitIls.toFixed(2)}  ` +
        `plate=¥${plateCny.toFixed(3)}/יח׳ (=₪${plateIls.toFixed(2)})  ` +
        `total=₪${r.totalOrderPriceIls.toFixed(2)}`
    );
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

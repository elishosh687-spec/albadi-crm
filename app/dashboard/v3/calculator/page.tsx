import { getFactoryConfig } from "@/lib/factory/config";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { CalculatorView } from "@/components/calculator/CalculatorView";

export const dynamic = "force-dynamic";

export default async function CalculatorPage() {
  const dbConfig = await getFactoryConfig({ fresh: true });
  const margins = dbConfig.profitMarginByQuantity ?? {
    "1000": dbConfig.defaultProfitMargin,
    "3000": dbConfig.defaultProfitMargin,
    "5000": dbConfig.defaultProfitMargin,
    "10000": dbConfig.defaultProfitMargin,
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">מחשבון מחיר</h1>
      <CalculatorView
        products={DEFAULT_CONFIG.products}
        quantityTiers={DEFAULT_CONFIG.quantityTiers}
        shippingOptions={DEFAULT_CONFIG.shippingOptions
          .map((s) => {
            const dbOpt = dbConfig.shippingOptions.find((d) => d.type === s.type && d.enabled);
            if (!dbOpt) return s;
            return { ...s, enabled: dbOpt.enabled, seaRate: dbOpt.seaRate ?? s.seaRate, airRates: dbOpt.airRates ?? s.airRates };
          })
          .filter((s) => s.enabled)}
        initialMargins={margins}
      />
    </div>
  );
}

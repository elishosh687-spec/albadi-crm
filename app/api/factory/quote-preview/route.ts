import { NextRequest, NextResponse } from "next/server";
import { calculateQuote } from "@/lib/factory/calculator/engine";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { getFactoryConfig } from "@/lib/factory/config";
import type { AppConfig, QuoteFormData } from "@/lib/factory/calculator/types";

export const runtime = "nodejs";

function buildConfig(
  dbConfig: Awaited<ReturnType<typeof getFactoryConfig>>,
  marginOverride: number | null
): AppConfig {
  const margins = marginOverride !== null
    ? { "1000": marginOverride, "3000": marginOverride, "5000": marginOverride, "10000": marginOverride }
    : (dbConfig.profitMarginByQuantity ?? {});

  return {
    ...DEFAULT_CONFIG,
    exchangeRates: { usdToIls: dbConfig.usdToIls, usdToCny: dbConfig.usdToCny },
    adminSettings: {
      globalProfitMargin: marginOverride ?? dbConfig.defaultProfitMargin,
      profitMarginByQuantity: margins,
    },
    shippingOptions: DEFAULT_CONFIG.shippingOptions.map((s) => {
      const dbOpt = dbConfig.shippingOptions.find((d) => d.type === s.type && d.enabled);
      if (!dbOpt) return s;
      return { ...s, enabled: dbOpt.enabled, seaRate: dbOpt.seaRate ?? s.seaRate, airRates: dbOpt.airRates ?? s.airRates };
    }),
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const product  = sp.get("product");
  const qty      = sp.get("qty");
  const shipping = sp.get("shipping");
  if (!product || !qty || !shipping) {
    return NextResponse.json({ error: "missing params: product, qty, shipping" }, { status: 400 });
  }

  const handles   = sp.get("handles") === "true";
  const lamination = sp.get("lamination") === "true";
  const colors    = Math.max(1, parseInt(sp.get("colors") ?? "1", 10) || 1);
  const marginRaw = sp.get("margin");
  const marginOverride = marginRaw !== null ? parseFloat(marginRaw) : null;

  const dbConfig = await getFactoryConfig();
  const cfg = buildConfig(dbConfig, marginOverride);

  const form: QuoteFormData = {
    productId: product,
    quantityTierId: qty,
    quantityOverride: null,
    hasHandles: handles,
    logoColors: colors,
    shippingOptionId: shipping,
    selectedFeatureIds: lamination ? ["f1"] : [],
  };

  const result = calculateQuote(form, cfg);
  if (!result) {
    return NextResponse.json({ error: "calc_failed", detail: `no result for product=${product} qty=${qty} shipping=${shipping}` }, { status: 422 });
  }

  const usdToIls = dbConfig.usdToIls;
  const productionPerUnitIls = result.unitProductionUsd * usdToIls;
  const shippingPerUnitIls   = result.shippingPerUnitUsd * usdToIls;

  const currentType = result.shippingOption?.type;
  const altShipping = currentType === "air"
    ? cfg.shippingOptions.find((s) => s.enabled && s.type === "sea")
    : currentType === "sea"
      ? cfg.shippingOptions.find((s) => s.enabled && s.type === "air")
      : null;
  const altResult = altShipping
    ? calculateQuote({ ...form, shippingOptionId: altShipping.id }, cfg)
    : null;

  return NextResponse.json({
    ok: true,
    result,
    altResult,
    computed: { productionPerUnitIls, shippingPerUnitIls, usdToIls, usdToCny: dbConfig.usdToCny },
  });
}

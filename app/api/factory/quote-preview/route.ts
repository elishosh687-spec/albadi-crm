import { NextRequest, NextResponse } from "next/server";
import { calculateQuote } from "@/lib/factory/calculator/engine";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { getFactoryConfig } from "@/lib/factory/config";
import type { AppConfig, Product, QuoteFormData } from "@/lib/factory/calculator/types";

export const runtime = "nodejs";

function buildConfig(
  dbConfig: Awaited<ReturnType<typeof getFactoryConfig>>,
  marginOverride: number | null,
  extraProducts: Product[] = []
): AppConfig {
  const margins = marginOverride !== null
    ? { "1000": marginOverride, "3000": marginOverride, "5000": marginOverride, "10000": marginOverride }
    : (dbConfig.profitMarginByQuantity ?? {});

  return {
    ...DEFAULT_CONFIG,
    products: [...DEFAULT_CONFIG.products, ...extraProducts],
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

function buildCustomProduct(sp: URLSearchParams): Product | null {
  const cnyRaw = sp.get("customUnitCostCny");
  const cny = cnyRaw ? parseFloat(cnyRaw) : NaN;
  if (!Number.isFinite(cny) || cny <= 0) return null;

  const num = (k: string, dflt = 0): number => {
    const v = parseFloat(sp.get(k) ?? "");
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };

  const cartonQty = Math.max(1, Math.round(num("customCartonQty", 250)));
  const cartonWeight = num("customCartonWeight", 5);
  const cartonLength = num("customCartonLength", 40);
  const cartonWidth = num("customCartonWidth", 30);
  const cartonHeight = num("customCartonHeight", 40);

  const widthCm = num("customWidthCm");
  const heightCm = num("customHeightCm");
  const depthCm = num("customDepthCm");
  const dimsParts: string[] = [];
  if (heightCm) dimsParts.push(`H${heightCm}`);
  if (depthCm) dimsParts.push(`D${depthCm}`);
  if (widthCm) dimsParts.push(`W${widthCm}`);
  const dimensions = dimsParts.join("*") || "מותאם";
  const description = (sp.get("customDescription") || "מוצר מותאם").slice(0, 200);

  const flatPrices = { "1000": cny, "3000": cny, "5000": cny, "10000": cny };
  const carton = {
    qty: cartonQty,
    weight: cartonWeight,
    length: cartonLength,
    width: cartonWidth,
    height: cartonHeight,
  };

  return {
    id: "custom",
    dimensions,
    description,
    sortOrder: 9999,
    laminationColorPlateFee: 0,
    withHandles: { prices: flatPrices, carton },
    withoutHandles: { prices: flatPrices, carton },
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

  const isCustom = product === "custom";
  const customProduct = isCustom ? buildCustomProduct(sp) : null;
  if (isCustom && !customProduct) {
    return NextResponse.json({ error: "invalid_custom_product", detail: "customUnitCostCny required and >0" }, { status: 400 });
  }

  const handles    = sp.get("handles") === "true";
  const lamination = sp.get("lamination") === "true";
  const colors     = Math.max(1, parseInt(sp.get("colors") ?? "1", 10) || 1);
  const marginRaw = sp.get("margin");
  const marginOverride = marginRaw !== null ? parseFloat(marginRaw) : null;
  const qtyOverrideRaw = sp.get("qtyOverride");
  const qtyOverrideParsed = qtyOverrideRaw ? parseInt(qtyOverrideRaw, 10) : NaN;
  const qtyOverride = Number.isFinite(qtyOverrideParsed) && qtyOverrideParsed > 0
    ? qtyOverrideParsed
    : null;

  const dbConfig = await getFactoryConfig({ fresh: true });
  const cfg = buildConfig(dbConfig, marginOverride, customProduct ? [customProduct] : []);

  const form: QuoteFormData = {
    productId: product,
    quantityTierId: qty,
    quantityOverride: qtyOverride,
    // Custom product has no handles/lamination/colors — force off.
    hasHandles: isCustom ? false : handles,
    logoColors: isCustom ? 1 : colors,
    shippingOptionId: shipping,
    selectedFeatureIds: isCustom ? [] : lamination ? ["f1"] : [],
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

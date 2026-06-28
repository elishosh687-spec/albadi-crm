/**
 * GET /api/factory/estimate — self-quote estimate for an arbitrary 80g spec.
 * Auth: dashboard cookie (middleware) OR ?widget_token= (middleware backdoor for /api/factory/*).
 *
 * Picks the cheapest factory that makes the spec (estimateFactoryCny), then runs
 * the SAME engine path as quote-preview (custom product priced at the estimated
 * CNY + carton, plate fee 版费 as the one-time molds line) so the calculator's
 * existing DetailedBreakdown renders it unchanged. Returns the estimate metadata
 * (factory, confidence, reasoning) alongside the full QuoteResult.
 */
import { NextRequest, NextResponse } from "next/server";
import { calculateQuote } from "@/lib/factory/calculator/engine";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { getFactoryConfig } from "@/lib/factory/config";
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";
import type { AppConfig, Product, QuoteFormData } from "@/lib/factory/calculator/types";

export const runtime = "nodejs";

function buildConfig(dbConfig: Awaited<ReturnType<typeof getFactoryConfig>>, custom: Product, marginOverride: number | null): AppConfig {
  // Mirror quote-preview: a margin override flattens every tier to the same
  // value for this calculation; null → fall back to the system tier margins.
  const margins = marginOverride !== null
    ? { "1000": marginOverride, "3000": marginOverride, "5000": marginOverride, "10000": marginOverride }
    : (dbConfig.profitMarginByQuantity ?? {});
  return {
    ...DEFAULT_CONFIG,
    products: [...DEFAULT_CONFIG.products, custom],
    seaCarriers: dbConfig.seaCarriers ?? DEFAULT_CONFIG.seaCarriers,
    activeSeaCarrierId: dbConfig.activeSeaCarrierId ?? DEFAULT_CONFIG.activeSeaCarrierId,
    assumedShipmentCbm: dbConfig.assumedShipmentCbm ?? DEFAULT_CONFIG.assumedShipmentCbm,
    exchangeRates: { usdToIls: dbConfig.usdToIls, usdToCny: dbConfig.usdToCny },
    adminSettings: { globalProfitMargin: marginOverride ?? dbConfig.defaultProfitMargin, profitMarginByQuantity: margins },
    shippingOptions: DEFAULT_CONFIG.shippingOptions.map((s) => {
      const dbOpt = dbConfig.shippingOptions.find((d) => d.type === s.type && d.enabled);
      return dbOpt ? { ...s, enabled: dbOpt.enabled, seaRate: dbOpt.seaRate ?? s.seaRate, airRates: dbOpt.airRates ?? s.airRates } : s;
    }),
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const num = (k: string) => { const v = parseFloat(sp.get(k) ?? ""); return Number.isFinite(v) ? v : 0; };
  const spec: EstimateSpec = {
    widthCm: num("widthCm"), heightCm: num("heightCm"), depthCm: num("depthCm"),
    quantity: Math.max(1, Math.round(num("qty"))),
    hasHandles: sp.get("handles") === "true",
    hasLamination: sp.get("lamination") === "true",
    logoColors: Math.max(1, parseInt(sp.get("colors") ?? "1", 10) || 1),
  };
  const shipping = sp.get("shipping") || "s1";
  // Optional operator overrides (mirror the regular calculator):
  //   margin       — target profit % override (null → system tier margins)
  //   moldsCostCny — Eli's own one-time mold/template fee, ADDED on top of the
  //                  factory plate fee (版费) the estimator already returns.
  const marginRaw = sp.get("margin");
  const marginParsed = marginRaw !== null ? parseFloat(marginRaw) : NaN;
  const marginOverride = Number.isFinite(marginParsed) && marginParsed >= 0 && marginParsed < 300 ? marginParsed : null;
  const moldsRaw = sp.get("moldsCostCny");
  const moldsParsed = moldsRaw ? parseFloat(moldsRaw) : NaN;
  const userMoldsCny = Number.isFinite(moldsParsed) && moldsParsed > 0 ? moldsParsed : 0;
  if (!spec.widthCm || !spec.heightCm || !spec.quantity) {
    return NextResponse.json({ error: "missing params: widthCm, heightCm, qty" }, { status: 400 });
  }

  const est = await estimateFactoryCny(spec);
  if (!est.ok) {
    return NextResponse.json({ ok: true, estimate: est }); // refused → UI shows "send to factory"
  }

  const dbConfig = await getFactoryConfig({ fresh: true });
  const cny = est.factoryUnitCostCny!;
  const c = est.carton ?? { qty: 250, weightKg: 5, lengthCm: 40, widthCm: 30, heightCm: 40 };
  const flat = { "1000": cny, "3000": cny, "5000": cny, "10000": cny };
  const custom: Product = {
    id: "estimate", dimensions: `H${spec.heightCm}${spec.depthCm ? `*D${spec.depthCm}` : ""}*W${spec.widthCm}`,
    description: `אומדן ${est.factoryName}`, sortOrder: 9999, laminationColorPlateFee: 0,
    withHandles: { prices: flat, carton: { qty: c.qty, weight: c.weightKg, length: c.lengthCm, width: c.widthCm, height: c.heightCm } },
    withoutHandles: { prices: flat, carton: { qty: c.qty, weight: c.weightKg, length: c.lengthCm, width: c.widthCm, height: c.heightCm } },
  };
  const cfg = buildConfig(dbConfig, custom, marginOverride);
  const form: QuoteFormData = {
    productId: "estimate", quantityTierId: "", quantityOverride: spec.quantity,
    hasHandles: false, logoColors: 1, shippingOptionId: shipping, selectedFeatureIds: [],
    // 版费 (auto plate fee) + Eli's own one-time mold/template fee, as the single
    // one-time line amortized across the order by the engine.
    moldsCostCny: (est.plateFeeOneTimeCny ?? 0) + userMoldsCny,
  };
  const result = calculateQuote(form, cfg);
  if (!result) return NextResponse.json({ ok: true, estimate: { ...est, ok: false, refused: "החישוב נכשל — שלח למפעל" } });

  const currentType = result.shippingOption?.type;
  const alt = currentType === "air" ? cfg.shippingOptions.find((s) => s.enabled && s.type === "sea")
    : currentType === "sea" ? cfg.shippingOptions.find((s) => s.enabled && s.type === "air") : null;
  const altResult = alt ? calculateQuote({ ...form, shippingOptionId: alt.id }, cfg) : null;

  return NextResponse.json({
    ok: true, estimate: est, result, altResult,
    computed: { productionPerUnitIls: result.unitProductionUsd * dbConfig.usdToIls, shippingPerUnitIls: result.shippingPerUnitUsd * dbConfig.usdToIls, usdToIls: dbConfig.usdToIls, usdToCny: dbConfig.usdToCny, commissionPct: dbConfig.commissionPct },
  });
}

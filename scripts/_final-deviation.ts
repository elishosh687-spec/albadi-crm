/**
 * Combined real-world deviation: for each real factory quote, compute the FINAL
 * selling price (₪/unit) two ways through the SAME engine (margin/FX/sea):
 *   ACTUAL = factory's real unit ¥ + real carton (cbm/qty/dims)
 *   ESTIMATE = מחשבון משוער predicted ¥ + predicted carton
 * The gap = the combined effect of BOTH errors (price + CBM) on the final price.
 * Run: DATABASE_URL="$(neonctl …)" npx tsx scripts/_final-deviation.ts
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
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
    adminSettings: { globalProfitMargin: dbConfig.defaultProfitMargin, profitMarginByQuantity: dbConfig.profitMarginByQuantity ?? {} },
    shippingOptions: DEFAULT_CONFIG.shippingOptions.map((s) => {
      const o = dbConfig.shippingOptions.find((d) => d.type === s.type && d.enabled);
      return o ? { ...s, enabled: o.enabled, seaRate: o.seaRate ?? s.seaRate, airRates: o.airRates ?? s.airRates } : s;
    }),
  };
}

const mkProduct = (h: number, d: number, w: number, cny: number, c: { qty: number; weight: number; length: number; width: number; height: number }): Product => {
  const flat = { "1000": cny, "3000": cny, "5000": cny, "10000": cny };
  const variant = { prices: flat, carton: c };
  return { id: "x", dimensions: `H${h}${d ? `*D${d}` : ""}*W${w}`, description: "x", sortOrder: 9999, laminationColorPlateFee: 0, withHandles: variant, withoutHandles: variant };
};

async function main() {
  const cfg0 = await getFactoryConfig({ fresh: true });
  const seaId = DEFAULT_CONFIG.shippingOptions.find((s) => s.type === "sea")?.id ?? "s2";
  type Resp = { supplier?: string; unitCostCny?: number; cartonQty?: number; cartonCbm?: number; cartonLengthCm?: number; cartonWidthCm?: number; cartonHeightCm?: number; weightKg?: number };
  type Spec = { material?: string; heightCm?: number; widthCm?: number; depthCm?: number; quantity?: number; printing?: string; finishing?: string };
  const rows = await db.select().from(factoryQuoteRequests);
  const seen = new Set<string>(); const devs: number[] = [];

  console.log("FINAL ₪/unit (sea) — actual factory data vs full estimate (price+CBM together)\n");
  console.log("quote        H  D  W   q     ₪ actual   ₪ estimate   Δ final");
  for (const row of rows) {
    const resp = row.factoryResponse as Resp | null; const spec = row.productSpec as Spec | null;
    if (!resp || !spec) continue;
    const ok80 = /80\s*(g|克|gsm)/i.test(spec.material ?? "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "");
    const h = spec.heightCm ?? 0, w = spec.widthCm ?? 0, d = spec.depthCm ?? 0; const q = spec.quantity ?? 0;
    if (!ok80 || !h || !w) continue;
    if (q < 3000 || q > 10000) continue;               // real order range only (MOQ 3000)
    if (d <= 2 || h < 10) continue;                    // gusseted only (flat/tray are flagged, not auto-quoted)
    const unit = resp.unitCostCny ?? 0; const cq = resp.cartonQty ?? 0;
    const cbm = resp.cartonCbm ?? (resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm ? (resp.cartonLengthCm * resp.cartonWidthCm * resp.cartonHeightCm) / 1e6 : 0);
    if (unit <= 0 || cq <= 0 || cbm <= 0) continue;
    const key = `${h}|${d}|${w}|${unit}|${cbm}`; if (seen.has(key)) continue; seen.add(key);

    const fin = spec.finishing ?? "";
    const sp: EstimateSpec = { heightCm: h, depthCm: d, widthCm: w, quantity: q, hasHandles: /handle|ידי/i.test(fin) && !/no handle|ללא/i.test(fin), hasLamination: /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin), logoColors: Math.max(1, parseInt((spec.printing ?? "1").match(/\d+/)?.[0] ?? "1", 10)) };
    const est = await estimateFactoryCny(sp); if (!est.ok || !est.carton) continue;

    const form: QuoteFormData = { productId: "x", quantityTierId: "", quantityOverride: q, hasHandles: false, logoColors: 1, shippingOptionId: seaId, selectedFeatureIds: [], moldsCostCny: 0 };
    // ACTUAL: factory ¥ + factory carton
    const actCarton = { qty: cq, weight: resp.weightKg ?? est.carton.weightKg, length: resp.cartonLengthCm ?? 40, width: resp.cartonWidthCm ?? 30, height: resp.cartonHeightCm ?? 40 };
    const qa = calculateQuote(form, buildConfig(cfg0, mkProduct(h, d, w, unit, actCarton)));
    // ESTIMATE: predicted ¥ + predicted carton
    const ec = est.carton; const estCarton = { qty: ec.qty, weight: ec.weightKg, length: ec.lengthCm, width: ec.widthCm, height: ec.heightCm };
    const qe = calculateQuote(form, buildConfig(cfg0, mkProduct(h, d, w, est.factoryUnitCostCny!, estCarton)));
    if (!qa || !qe) continue;
    const pa = qa.sellingPricePerUnitIls, pe = qe.sellingPricePerUnitIls;
    const dv = ((pe - pa) / pa) * 100; devs.push(dv);
    console.log(`${(row.quotationNo ?? "?").padEnd(11)} ${String(h).padStart(2)} ${String(d).padStart(2)} ${String(w).padStart(2)} ${String(q).padStart(5)}   ₪${pa.toFixed(2).padStart(6)}    ₪${pe.toFixed(2).padStart(6)}    ${dv >= 0 ? "+" : ""}${dv.toFixed(1)}%`);
  }
  const a = devs.map(Math.abs).sort((x, y) => x - y);
  const med = a[Math.floor(a.length / 2)], p90 = a[Math.min(a.length - 1, Math.floor(a.length * 0.9))], mx = a[a.length - 1];
  const signedMean = devs.reduce((s, x) => s + x, 0) / devs.length;
  console.log(`\nCOMBINED final-price deviation (price+CBM together): |median|=${med.toFixed(1)}%  p90=${p90.toFixed(1)}%  max=${mx.toFixed(1)}%  | mean(signed)=${signedMean >= 0 ? "+" : ""}${signedMean.toFixed(1)}%  (n=${devs.length})`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

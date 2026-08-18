/**
 * Test the CURRENT calculator on the most-recent real 3D factory quotes.
 * Pull the last N 3D quotes from the DB, run each spec through estimateFactoryCny
 * (measure mode = the deployed calculator, no safety buffer), and compare its
 * factory price + shipping to what the factory actually charged.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { estimateFactoryCny } from "@/lib/factory/estimator";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import { colorsFromText } from "@/lib/factory/server/estimator-fit";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";

const parseHandles = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|not.*handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);
const is80 = (m: string) => /80\s*(g|克|gsm)/i.test(m || "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(m || "");
const N = parseInt(process.argv[2] || "4", 10);

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const cfg = await getFactoryConfig();
  const sea = cfg.shippingOptions.find((s) => s.type === "sea" && s.enabled);
  const rows: any[] = await sql`
    SELECT quotation_no, created_at, product_spec as ps, factory_response as fr
    FROM factory_quote_requests
    WHERE (product_spec->>'depthCm')::numeric > 2
      AND (product_spec->>'heightCm')::numeric > 0
      AND (factory_response->>'unitCostCny')::numeric > 0
      AND (factory_response->>'cartonQty')::numeric > 0
      AND (factory_response->>'cartonCbm')::numeric > 0
    ORDER BY created_at DESC LIMIT 40`;

  const picked = rows.filter((r) => is80(((r.ps ?? {}).material ?? "").toString())).slice(0, N);
  console.log(`\n═══ ${picked.length} הצעות תלת-מימד אחרונות מול המחשבון הנוכחי ═══\n`);

  for (const r of picked) {
    const ps = r.ps as FactoryProductSpec, fr = r.fr as FactoryResponse;
    const colors = colorsFromText((ps.printing ?? "1").toString());
    const spec = { widthCm: ps.widthCm, heightCm: ps.heightCm, depthCm: ps.depthCm ?? 0, quantity: ps.quantity ?? 0, hasHandles: parseHandles((ps.finishing ?? "").toString()), hasLamination: parseLam((ps.finishing ?? "").toString()), logoColors: colors };
    const date = new Date(r.created_at).toISOString().slice(0, 10);
    console.log(`▶ ${ps.heightCm}×${ps.widthCm}×D${ps.depthCm} · ${ps.quantity} יח׳ · ${colors} צבע${spec.hasLamination ? " · למינציה" : ""}${spec.hasHandles ? " · ידית" : ""}   (${r.quotation_no}, ${date})`);

    // current calculator (measure = deployed, no buffer)
    const est = await estimateFactoryCny(spec, undefined, { measure: true });
    if (!est.ok) { console.log(`   המחשבון: סירב → ${est.refused}\n`); continue; }

    const actCartons = Math.ceil(ps.quantity! / fr.cartonQty!), actCbm = actCartons * fr.cartonCbm!;
    const eq = est.carton?.qty ?? 0, ecbmC = (est.carton?.cbmPerUnit ?? 0) * eq, ecartons = eq ? Math.ceil(ps.quantity! / eq) : 0, estCbm = ecartons * ecbmC;
    const actP = priceFactoryQuote({ factoryUnitCostCny: fr.unitCostCny, quantity: ps.quantity!, shippingOptionId: sea?.id ?? null, cartonSpec: { qty: fr.cartonQty, weightKg: fr.weightKg, cbm: fr.cartonCbm, lengthCm: fr.cartonLengthCm, widthCm: fr.cartonWidthCm, heightCm: fr.cartonHeightCm }, profitMarginOverride: 40, moldsCostCny: 0, platePerColorCny: fr.platePerColorCny, logoColors: colors }, cfg);
    const estP = priceFactoryQuote({ factoryUnitCostCny: est.factoryUnitCostCny!, quantity: ps.quantity!, shippingOptionId: sea?.id ?? null, cartonSpec: { qty: eq, weightKg: est.carton?.weightKg, cbm: ecbmC, lengthCm: est.carton?.lengthCm, widthCm: est.carton?.widthCm, heightCm: est.carton?.heightCm }, profitMarginOverride: 40, moldsCostCny: 0, platePerColorCny: est.platePerColorCny, logoColors: colors }, cfg);
    const du = (est.factoryUnitCostCny! - fr.unitCostCny) / fr.unitCostCny * 100;
    const ds = actP.totalShipping > 0 ? (estP.totalShipping - actP.totalShipping) / actP.totalShipping * 100 : 0;

    console.log(`   מחיר מפעל:  אמת ¥${fr.unitCostCny}  →  מחשבון ¥${est.factoryUnitCostCny}   (${du >= 0 ? "+" : ""}${du.toFixed(0)}%)`);
    console.log(`   שילוח:      אמת ₪${actP.totalShipping}  →  מחשבון ₪${estP.totalShipping}   (${ds >= 0 ? "+" : ""}${ds.toFixed(0)}%)`);
    console.log(`   אריזה:      אמת ${fr.cartonQty}/קרטון (CBM ${actCbm.toFixed(2)})  →  מחשבון ${eq}/קרטון (CBM ${estCbm.toFixed(2)})`);
    console.log("");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

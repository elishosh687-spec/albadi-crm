/**
 * Compare the self-quote estimator (מחשבון משוער) against what the factory
 * actually quoted, for a set of quotation numbers. For each: factory unit CNY
 * + carton/CBM + sea shipping, vs the estimator's prediction for the SAME spec.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { estimateFactoryCny, type EstimateSpec } from "@/lib/factory/estimator";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";

function parseHandles(fin: string): boolean {
  return /with handles|עם ידיות/i.test(fin) && !/no handles|ללא ידיות/i.test(fin);
}
function parseLam(fin: string): boolean {
  return /(?<!not )laminated|למינציה/i.test(fin) && !/not laminated|ללא למינציה/i.test(fin);
}
function parseColors(printing: string): number {
  const m = /(\d+)/.exec(printing ?? "");
  return m ? Math.max(1, parseInt(m[1])) : 1;
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const config = await getFactoryConfig();
  const qs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  let list = qs;
  if (!list.length) {
    // All quotes with a real spec (dims + qty > 0) and a factory unit cost.
    const rows: any = await sql`
      SELECT quotation_no FROM factory_quote_requests
      WHERE (product_spec->>'quantity')::numeric > 0
        AND (product_spec->>'widthCm')::numeric > 0
        AND (factory_response->>'unitCostCny')::numeric > 0
        AND (factory_response->>'cartonQty')::numeric > 0
        AND (factory_response->>'cartonCbm')::numeric > 0
      ORDER BY created_at DESC`;
    list = rows.map((r: any) => r.quotation_no);
  }
  const shipDeltas: number[] = [];
  const unitDeltas: number[] = [];

  // find the sea shipping option
  const seaOpt = config.shippingOptions.find((s) => s.type === "sea" && s.enabled);

  for (const q of list) {
    const r: any = (
      await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests WHERE quotation_no=${q}`
    )[0];
    if (!r) {
      console.log(`\n${q}: not found`);
      continue;
    }
    const ps = r.ps as FactoryProductSpec;
    const fr = r.fr as FactoryResponse;
    const colors = parseColors(ps.printing);
    const spec: EstimateSpec = {
      widthCm: ps.widthCm,
      heightCm: ps.heightCm,
      depthCm: ps.depthCm,
      quantity: ps.quantity,
      hasHandles: parseHandles(ps.finishing),
      hasLamination: parseLam(ps.finishing),
      logoColors: colors,
    };

    console.log(`\n═══ ${q} ═══`);
    console.log(
      `spec: ${ps.widthCm}×${ps.heightCm}×${ps.depthCm} cm · qty ${ps.quantity} · ${colors} צבע · handles=${spec.hasHandles} lam=${spec.hasLamination}`
    );

    // ---- FACTORY actual ----
    const factCarton = fr.cartonQty ?? 0;
    const factCartons = factCarton ? Math.ceil(ps.quantity / factCarton) : 0;
    const factCbm = factCartons * (fr.cartonCbm ?? 0);
    const factPrice = priceFactoryQuote(
      {
        factoryUnitCostCny: fr.unitCostCny,
        quantity: ps.quantity,
        shippingOptionId: seaOpt?.id ?? null,
        cartonSpec: {
          qty: fr.cartonQty,
          weightKg: fr.weightKg,
          cbm: fr.cartonCbm,
          lengthCm: fr.cartonLengthCm,
          widthCm: fr.cartonWidthCm,
          heightCm: fr.cartonHeightCm,
        },
        profitMarginOverride: 40,
        moldsCostCny: 0,
        platePerColorCny: fr.platePerColorCny,
        logoColors: colors,
      },
      config
    );
    console.log(
      `FACTORY : unit ¥${fr.unitCostCny} · ${factCarton}/carton → ${factCartons} cartons · CBM/unit ${(fr.cartonCbm && factCarton ? fr.cartonCbm / factCarton : 0).toFixed(5)} · totalCBM ${factCbm.toFixed(3)} · שילוח ים ₪${factPrice.totalShipping} (₪${factPrice.unitShipping}/יח׳)`
    );

    // ---- ESTIMATOR ----
    const est = await estimateFactoryCny(spec);
    if (!est.ok) {
      console.log(`ESTIM.  : refused → ${est.refused}`);
      continue;
    }
    const estCartons = est.carton?.qty ? Math.ceil(ps.quantity / est.carton.qty) : 0;
    const estCbm = (est.carton?.cbmPerUnit ?? 0) * ps.quantity;
    const estPrice = priceFactoryQuote(
      {
        factoryUnitCostCny: est.factoryUnitCostCny!,
        quantity: ps.quantity,
        shippingOptionId: seaOpt?.id ?? null,
        cartonSpec: {
          qty: est.carton?.qty,
          weightKg: est.carton?.weightKg,
          cbm: est.carton ? est.carton.cbmPerUnit * est.carton.qty : undefined,
          lengthCm: est.carton?.lengthCm,
          widthCm: est.carton?.widthCm,
          heightCm: est.carton?.heightCm,
        },
        profitMarginOverride: 40,
        moldsCostCny: 0,
        platePerColorCny: est.platePerColorCny,
        logoColors: colors,
      },
      config
    );
    console.log(
      `ESTIM.  : unit ¥${est.factoryUnitCostCny} (${est.factoryName}) · ${est.carton?.qty}/carton → ${estCartons} cartons · CBM/unit ${(est.carton?.cbmPerUnit ?? 0).toFixed(5)} · totalCBM ${estCbm.toFixed(3)} · שילוח ים ₪${estPrice.totalShipping} (₪${estPrice.unitShipping}/יח׳) · conf=${est.carton?.confidence}`
    );

    // ---- deltas ----
    const dUnit = ((est.factoryUnitCostCny! - fr.unitCostCny) / fr.unitCostCny) * 100;
    const dShip =
      factPrice.totalShipping > 0
        ? ((estPrice.totalShipping - factPrice.totalShipping) / factPrice.totalShipping) * 100
        : 0;
    console.log(
      `Δ       : עלות יחידה ${dUnit >= 0 ? "+" : ""}${dUnit.toFixed(0)}% · שילוח ${dShip >= 0 ? "+" : ""}${dShip.toFixed(0)}%`
    );
    unitDeltas.push(dUnit);
    if (factPrice.totalShipping > 0) shipDeltas.push(dShip);
  }

  const median = (a: number[]) => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  console.log(`\n══════ סיכום מצרפי (${unitDeltas.length} הצעות שהמחשבון תמחר) ══════`);
  console.log(
    `עלות יחידה: חציון ${median(unitDeltas).toFixed(0)}% · ממוצע ${mean(unitDeltas).toFixed(0)}%`
  );
  console.log(
    `שילוח:      חציון ${median(shipDeltas).toFixed(0)}% · ממוצע ${mean(shipDeltas).toFixed(0)}%`
  );
  console.log(`(שלילי = המחשבון מעריך פחות מהמפעל)`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

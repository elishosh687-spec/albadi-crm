/**
 * Repair TZYXNDEW:
 *  - factory_response in DB has only {supplier, hasResponse, unitCostCny=1.03}
 *    because the cron flipped 'received' before the factory filled L..Q.
 *  - Feishu row 21 has the FULL response: qty=200, dims=45×35×45, cbm=0.07, weight=9.
 *  - Pull full row, merge into factory_response, recompute final_pricing,
 *    clear pdf_url so the next view re-renders.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { readRow, parseFactoryResponseRow } from "@/lib/feishu/sheets";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, feishu_row_index, product_spec, factory_response, final_pricing
    FROM factory_quote_requests
    WHERE upper(quotation_no) = 'TZYXNDEW'
  `) as Array<{
    id: string;
    feishu_row_index: string;
    product_spec: FactoryProductSpec;
    factory_response: FactoryResponse;
    final_pricing: Record<string, unknown> | null;
  }>;
  if (rows.length === 0) { console.log("not found"); return; }
  const row = rows[0];

  // Pull full row from Feishu
  const cells = await readRow(row.feishu_row_index);
  const fresh = parseFactoryResponseRow(cells);
  console.log("fresh from Feishu:", JSON.stringify(fresh, null, 2));

  // Merge — fresh wins where present, stored otherwise.
  const merged: FactoryResponse = {
    unitCostCny: fresh.unitCostCny || row.factory_response.unitCostCny || 0,
    cartonQty: fresh.cartonQty ?? row.factory_response.cartonQty,
    cartonLengthCm: fresh.cartonLengthCm ?? row.factory_response.cartonLengthCm,
    cartonWidthCm: fresh.cartonWidthCm ?? row.factory_response.cartonWidthCm,
    cartonHeightCm: fresh.cartonHeightCm ?? row.factory_response.cartonHeightCm,
    cartonCbm: fresh.cartonCbm ?? row.factory_response.cartonCbm,
    weightKg: fresh.weightKg ?? row.factory_response.weightKg,
    supplier: fresh.supplier ?? row.factory_response.supplier,
    notes: fresh.notes ?? row.factory_response.notes,
  };
  console.log("\nmerged factory_response:", JSON.stringify(merged, null, 2));

  // Recompute final_pricing using saved choices.
  const old = row.final_pricing ?? {};
  const profitMarginOverride = typeof old.profitMarginPct === "number" ? old.profitMarginPct : undefined;
  const shippingOptionId = typeof old.shippingOptionId === "string" ? old.shippingOptionId : undefined;
  const moldsCostCny = typeof old.moldsTotalCny === "number" ? old.moldsTotalCny : undefined;

  const config = await getFactoryConfig();
  const spec = row.product_spec;
  const pricing = priceFactoryQuote(
    {
      factoryUnitCostCny: merged.unitCostCny,
      quantity: spec.quantity,
      shippingOptionId: shippingOptionId ?? null,
      cartonSpec: {
        qty: merged.cartonQty,
        weightKg: merged.weightKg,
        cbm: merged.cartonCbm,
        lengthCm: merged.cartonLengthCm,
        widthCm: merged.cartonWidthCm,
        heightCm: merged.cartonHeightCm,
      },
      profitMarginOverride,
      moldsCostCny,
    },
    config
  );
  console.log("\nnew final_pricing:", JSON.stringify(pricing, null, 2));

  await sql`
    UPDATE factory_quote_requests
    SET factory_response = ${JSON.stringify(merged)}::jsonb,
        final_pricing    = ${JSON.stringify(pricing)}::jsonb,
        pdf_url          = NULL,
        updated_at       = NOW()
    WHERE id = ${row.id}
  `;
  console.log(`\nDone. Updated ${row.id}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

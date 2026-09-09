/**
 * One-off: recompute `final_pricing` for quote 15JQUZLK using the NEW pricing
 * engine (mold split into its own line item). Clears `pdf_url` so the next
 * GET /api/factory/[id]/pdf re-renders from the fresh snapshot.
 *
 * Why: the user already finalized this quote BEFORE the mold-split deploy.
 * The saved snapshot has the old shape (mold amortized into unitCost,
 * no moldsTotalSellingPriceIls field), so even with the new code, the PDF
 * re-render reads that old snapshot and shows the old layout. This rewrites
 * the snapshot via the new `priceFactoryQuote`.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, manychat_sub_id, product_spec, factory_response, final_pricing
    FROM factory_quote_requests
    WHERE upper(quotation_no) = '15JQUZLK'
  `) as Array<{
    id: string;
    manychat_sub_id: string;
    product_spec: FactoryProductSpec;
    factory_response: FactoryResponse;
    final_pricing: Record<string, unknown> | null;
  }>;
  if (rows.length === 0) {
    console.log("not found");
    return;
  }
  const row = rows[0];
  if (!row.factory_response) {
    console.log("no factory_response — cannot recompute");
    return;
  }

  // Carry over the choices from the OLD snapshot so the recompute mirrors what
  // the user already settled on (margin %, shipping option, mold cost in CNY).
  const old = row.final_pricing ?? {};
  const profitMarginOverride = typeof old.profitMarginPct === "number" ? old.profitMarginPct : undefined;
  const shippingOptionId = typeof old.shippingOptionId === "string" ? old.shippingOptionId : undefined;
  const moldsCostCny = typeof old.moldsTotalCny === "number" ? old.moldsTotalCny : undefined;

  console.log("Recomputing with:");
  console.log("  margin %:", profitMarginOverride);
  console.log("  shipping:", shippingOptionId);
  console.log("  moldsCostCny:", moldsCostCny);

  const config = await getFactoryConfig();
  const resp = row.factory_response;
  const spec = row.product_spec;

  const pricing = priceFactoryQuote(
    {
      factoryUnitCostCny: resp.unitCostCny,
      quantity: spec.quantity,
      shippingOptionId: shippingOptionId ?? null,
      cartonSpec: {
        qty: resp.cartonQty,
        weightKg: resp.weightKg,
        cbm: resp.cartonCbm,
        lengthCm: resp.cartonLengthCm,
        widthCm: resp.cartonWidthCm,
        heightCm: resp.cartonHeightCm,
      },
      profitMarginOverride,
      moldsCostCny,
    },
    config
  );

  console.log("\nNew pricing snapshot:");
  console.log(JSON.stringify(pricing, null, 2));

  await sql`
    UPDATE factory_quote_requests
    SET final_pricing = ${JSON.stringify(pricing)}::jsonb,
        pdf_url = NULL,
        updated_at = NOW()
    WHERE id = ${row.id}
  `;
  console.log(`\nDone. Updated row ${row.id}. pdf_url cleared — next view re-renders.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db.execute(sql`
    SELECT
      quotation_no,
      factory_status,
      product_spec->>'description'   AS description,
      product_spec->>'widthCm'       AS w,
      product_spec->>'heightCm'      AS h,
      product_spec->>'depthCm'       AS d,
      product_spec->>'quantity'      AS qty,
      product_spec->>'printing'      AS printing,
      product_spec->>'finishing'     AS finishing,
      factory_response->>'unitCostCny' AS unit_cny,
      factory_response->>'cartonQty'   AS carton_qty,
      factory_response->>'cartonCbm'   AS carton_cbm,
      factory_response->>'weightKg'    AS weight_kg,
      factory_response->>'supplier'    AS supplier
    FROM factory_quote_requests
    WHERE product_spec->>'material' = '80g non-woven'
      AND factory_status IN ('received','finalized')
      AND factory_response IS NOT NULL
    ORDER BY created_at DESC
  `);
  console.table(rows.rows);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

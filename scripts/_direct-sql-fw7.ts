import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT id, quotation_no, feishu_row_index, factory_status,
           updated_at,
           factory_response->>'unitCostCny' as unit,
           factory_response->>'cartonQty' as qty,
           factory_response->>'cartonLengthCm' as len,
           factory_response->>'cartonWidthCm' as wid,
           factory_response->>'cartonHeightCm' as hei,
           factory_response->>'cartonCbm' as cbm,
           factory_response->>'weightKg' as kg,
           factory_response->>'supplier' as supplier,
           product_spec->>'quantity' as qty_ordered
    FROM factory_quote_requests
    WHERE quotation_no = 'FW7BYGAO'
    ORDER BY updated_at DESC
  `;
  console.log(`rows: ${rows.length}`);
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

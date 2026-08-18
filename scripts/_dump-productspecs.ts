import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT quotation_no, created_at,
           product_spec->>'quantity' as qty,
           product_spec->>'widthCm' as w,
           product_spec->>'heightCm' as h,
           product_spec->>'depthCm' as d,
           product_spec->>'printing' as printing,
           product_spec->>'finishing' as finishing,
           product_spec->>'material' as material,
           product_spec->>'description' as descr
    FROM factory_quote_requests
    ORDER BY created_at DESC
    LIMIT 20
  `;
  for (const r of rows as any[]) {
    const bad = (r.qty === "0" || r.w === "0") ? "⚠️" : "  ";
    console.log(
      `${bad} ${r.quotation_no}  qty=${r.qty} W×H×D=${r.w}×${r.h}×${r.d} print="${r.printing}" fin="${r.finishing}" mat="${r.material}"`
    );
  }
  process.exit(0);
}
main();

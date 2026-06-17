import "dotenv/config";
import { neon } from "@neondatabase/serverless";
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, quotation_no, factory_status, feishu_row_index,
           created_at, pdf_url IS NOT NULL AS has_pdf,
           final_pricing IS NOT NULL AS has_pricing,
           sent_to_customer_at
    FROM factory_quote_requests
    WHERE upper(quotation_no) = 'TZYXNDEW'
    ORDER BY created_at
  `) as Array<Record<string, unknown>>;
  console.log(`TZYXNDEW rows: ${rows.length}`);
  for (const r of rows) console.log(JSON.stringify(r));
}
main().catch((e) => { console.error(e); process.exit(1); });

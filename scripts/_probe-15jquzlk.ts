import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, quotation_no, factory_status, pdf_url, sent_to_customer_at,
           updated_at, final_pricing, product_spec, factory_response
    FROM factory_quote_requests
    WHERE upper(quotation_no) = '15JQUZLK'
  `) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) { console.log("not found"); return; }
  console.log("id:", r.id);
  console.log("status:", r.factory_status);
  console.log("pdf_url:", r.pdf_url);
  console.log("sent_to_customer_at:", r.sent_to_customer_at);
  console.log("updated_at:", r.updated_at);
  console.log("\nproduct_spec:");
  console.log(JSON.stringify(r.product_spec, null, 2));
  console.log("\nfactory_response:");
  console.log(JSON.stringify(r.factory_response, null, 2));
  console.log("\nfinal_pricing:");
  console.log(JSON.stringify(r.final_pricing, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });

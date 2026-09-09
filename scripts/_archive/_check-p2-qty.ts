import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT quotation_no,
           product_spec
    FROM factory_quote_requests
    WHERE quotation_no = 'P2WXR65R'
  `;
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
main();

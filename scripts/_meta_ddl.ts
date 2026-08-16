import { neon } from "@neondatabase/serverless";
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  // Purchase had no stamp at all, so nothing could tell which deals reached
  // Meta. Deal-level (not lead-level): one lead can close several deals.
  await sql`ALTER TABLE factory_quote_requests
              ADD COLUMN IF NOT EXISTS meta_purchase_sent_at timestamptz`;
  await sql`ALTER TABLE factory_quote_requests
              ADD COLUMN IF NOT EXISTS meta_purchase_value_ils numeric`;
  await sql`ALTER TABLE factory_quote_requests
              ADD COLUMN IF NOT EXISTS meta_purchase_error text`;
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='factory_quote_requests' AND column_name LIKE 'meta_%'
    ORDER BY column_name`;
  console.log(JSON.stringify(cols));
}
main();

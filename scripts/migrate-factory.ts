/**
 * One-off migration: add factory pipeline tables.
 *
 *   - app_config            (k/v JSON, for factory_pricing config)
 *   - factory_quote_requests (one row per send-to-factory event)
 *
 * Idempotent — uses `CREATE TABLE IF NOT EXISTS` so safe to re-run.
 *
 * Run: `npx tsx scripts/migrate-factory.ts`
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  console.log("→ creating app_config...");
  await sql`
    CREATE TABLE IF NOT EXISTS app_config (
      key text PRIMARY KEY NOT NULL,
      value jsonb NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `;

  console.log("→ creating factory_quote_requests...");
  await sql`
    CREATE TABLE IF NOT EXISTS factory_quote_requests (
      id text PRIMARY KEY NOT NULL,
      manychat_sub_id text NOT NULL,
      quotation_no text,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      product_spec jsonb NOT NULL,
      feishu_row_index text,
      factory_status text NOT NULL DEFAULT 'pending',
      factory_response jsonb,
      final_pricing jsonb,
      pdf_url text,
      sent_to_customer_at timestamp with time zone
    )
  `;

  console.log("→ creating index factory_quote_requests_manychat_sub_id_idx...");
  await sql`
    CREATE INDEX IF NOT EXISTS factory_quote_requests_manychat_sub_id_idx
      ON factory_quote_requests (manychat_sub_id)
  `;

  console.log("→ creating index factory_quote_requests_status_idx...");
  await sql`
    CREATE INDEX IF NOT EXISTS factory_quote_requests_status_idx
      ON factory_quote_requests (factory_status)
  `;

  console.log("✓ done");
}

main().catch((err) => {
  console.error("✗ migration failed:", err);
  process.exit(1);
});

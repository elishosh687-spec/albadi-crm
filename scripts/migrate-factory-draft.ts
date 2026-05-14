/**
 * Add the `factory_spec_draft` JSONB column to `leads`.
 *
 * Stores a manually-entered factory product spec that hasn't been sent yet,
 * so Eli can fill the form, push it to the order summary panel, review/add
 * notes, and only then submit to Feishu. Cleared automatically when the
 * spec is successfully posted to /api/factory/quote-request.
 *
 * Run: `npx tsx scripts/migrate-factory-draft.ts`
 * Idempotent — uses IF NOT EXISTS.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  console.log("→ adding leads.factory_spec_draft (jsonb)…");
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS factory_spec_draft jsonb`;
  console.log("✓ done");
}

main().catch((err) => {
  console.error("✗ migration failed:", err);
  process.exit(1);
});

/**
 * Creates the `competitor_prices` table via raw DDL.
 *
 * We do NOT use `drizzle-kit push` — it hangs on the orphan `configurator_*`
 * create-vs-rename TUI prompt (see CLAUDE.md, same reason `lead_analyses` was
 * created by hand). Idempotent: safe to re-run.
 *
 * Run:
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string \
 *     --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" \
 *     npx tsx scripts/_create-competitor-prices.ts
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS competitor_prices (
      id                    bigserial PRIMARY KEY,
      product               text NOT NULL,
      quantity              integer,
      our_price             double precision,
      our_lead_days         integer,
      competitor            text NOT NULL,
      competitor_price      double precision,
      competitor_lead_days  integer,
      lead_sid              text,
      notes                 text,
      created_at            timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS competitor_prices_product_created_idx
      ON competitor_prices (product, created_at)
  `;

  const [{ count }] = (await sql`SELECT count(*)::int AS count FROM competitor_prices`) as {
    count: number;
  }[];
  console.log(`✓ competitor_prices ready (${count} rows)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

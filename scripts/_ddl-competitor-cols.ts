/**
 * DDL: the columns Eli's own competitor price list needs.
 *
 * Direct DDL, not `drizzle-kit push` — push hangs on a create-vs-rename TUI
 * prompt because of the orphan configurator_* tables (see CLAUDE.md).
 *
 * Why each one, from the real data he collected:
 *  - origin            ישראל vs סין is the whole story. Print-Tek is ₪6.45 in
 *                      Israel and ₪2.49 in China for the same 30×40 bag.
 *  - gsm               80GSM throughout, but it is a spec we price by, and a
 *                      competitor quoting 70GSM is not the same product.
 *  - shipping_included "כולל משלוח" vs "ללא משלוח" moves the real number by
 *                      more than most of the price gaps in the table.
 *  - lead_time_text    His data is ranges ("60-90 ימים", "כשבועיים"). The
 *                      integer column alone would silently invent precision.
 *  - competitor_plate_fee_currency
 *                      One row is "150 דולר" and another "500 ש\"ח לצבע".
 *                      Storing both as bare 150/500 would be a 3.7× error.
 *
 * Idempotent — ADD COLUMN IF NOT EXISTS. Safe to re-run.
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

const COLS: { name: string; ddl: string }[] = [
  { name: "origin", ddl: "text" },
  { name: "gsm", ddl: "integer" },
  { name: "shipping_included", ddl: "boolean" },
  { name: "lead_time_text", ddl: "text" },
  { name: "competitor_plate_fee_currency", ddl: "text" },
  // Where OUR number came from: the exact catalog calculator, the estimator
  // model, or a real factory quote. Eli asked for this explicitly — an
  // estimator number and a catalog number do not carry the same confidence,
  // and a comparison that hides which is which is misleading.
  { name: "our_price_source", ddl: "text" },
];

async function main() {
  for (const c of COLS) {
    await db.execute(
      sql.raw(
        `alter table competitor_prices add column if not exists ${c.name} ${c.ddl}`,
      ),
    );
    console.log(`✓ ${c.name} ${c.ddl}`);
  }
  const r = await db.execute(
    sql`select column_name, data_type from information_schema.columns
        where table_name = 'competitor_prices' order by ordinal_position`,
  );
  console.log("\n=== competitor_prices ===");
  for (const row of (r as unknown as { rows: any[] }).rows) {
    console.log(`  ${row.column_name.padEnd(32)} ${row.data_type}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

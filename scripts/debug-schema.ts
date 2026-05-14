import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("=== ALL TABLES ===");
  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
    ORDER BY table_name
  `);
  console.table(tables.rows);

  console.log("\n=== COLUMNS WITH 'phone' OR 'wa' IN NAME ===");
  const cols = await db.execute(sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public'
      AND (column_name ILIKE '%phone%' OR column_name ILIKE '%wa%' OR column_name ILIKE '%contact%')
    ORDER BY table_name, column_name
  `);
  console.table(cols.rows);

  console.log("\n=== SAMPLE: leads with NULL phone but with name (3) ===");
  const r = await db.execute(sql`
    SELECT *
    FROM leads
    WHERE phone_e164 IS NULL AND name IS NOT NULL AND active = true
    LIMIT 3
  `);
  for (const row of r.rows) {
    console.log(JSON.stringify(row, null, 2));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("=== LEAD CONTACT FIELDS (top 15 active) ===");
  const r = await db.execute(sql`
    SELECT
      manychat_sub_id,
      name,
      phone_e164,
      wa_jid,
      source,
      pipeline_stage
    FROM leads
    WHERE active = true
    ORDER BY updated_at DESC
    LIMIT 15
  `);
  console.table(r.rows);

  console.log("\n=== SUMMARY ===");
  const s = await db.execute(sql`
    SELECT
      count(*)::int AS total_active,
      count(*) FILTER (WHERE name IS NOT NULL)::int AS with_name,
      count(*) FILTER (WHERE phone_e164 IS NOT NULL)::int AS with_phone,
      count(*) FILTER (WHERE name IS NOT NULL AND phone_e164 IS NULL)::int AS name_no_phone,
      count(*) FILTER (WHERE source LIKE '%bridge%')::int AS bridge_origin,
      count(*) FILTER (WHERE source NOT LIKE '%bridge%' OR source IS NULL)::int AS manychat_origin
    FROM leads
    WHERE active = true
  `);
  console.table(s.rows);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

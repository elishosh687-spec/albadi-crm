import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT id, status, suggested_stage, approved_stage, suggested_summary, reason,
      created_at, reviewed_at
    FROM pipeline_suggestions
    WHERE TRIM(manychat_sub_id) = '738273208'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log(JSON.stringify((r.rows ?? r), null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

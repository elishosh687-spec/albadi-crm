import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT id, manychat_sub_id, source, status,
      suggested_stage, approved_stage,
      created_at, reviewed_at, pushed_to_manychat_at
    FROM pipeline_suggestions
    ORDER BY created_at DESC
    LIMIT 15
  `);
  console.log(JSON.stringify((r.rows ?? r), null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

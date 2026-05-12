import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    INSERT INTO analysis_queue (manychat_sub_id, reason)
    SELECT l.manychat_sub_id, 'manual_refresh'
    FROM leads l
    WHERE l.active = true
      -- exclude leads already in queue (pending/analyzing)
      AND NOT EXISTS (
        SELECT 1 FROM analysis_queue q
        WHERE q.manychat_sub_id = l.manychat_sub_id
          AND q.status IN ('pending', 'analyzing')
      )
      -- only stale: latest suggestion >24h old, or no suggestion at all
      AND (
        NOT EXISTS (
          SELECT 1 FROM pipeline_suggestions ps
          WHERE TRIM(ps.manychat_sub_id) = TRIM(l.manychat_sub_id)
        )
        OR (
          SELECT MAX(ps.created_at) FROM pipeline_suggestions ps
          WHERE TRIM(ps.manychat_sub_id) = TRIM(l.manychat_sub_id)
        ) < NOW() - INTERVAL '24 hours'
      )
    RETURNING manychat_sub_id
  `);
  const rows = (r.rows ?? r) as Array<{ manychat_sub_id: string }>;
  console.log(`Queued ${rows.length} stale leads:`);
  for (const x of rows) console.log(`  ${x.manychat_sub_id}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

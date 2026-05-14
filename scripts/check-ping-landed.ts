import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  const r = await db.execute(sql`
    SELECT evt_id, type, tenant, occurred_at, received_at
    FROM bridge_events
    WHERE evt_id = 'evt_01KRHJJ9VDKR7B6C5TK7CSTF4A'
       OR received_at > NOW() - INTERVAL '5 minutes'
    ORDER BY received_at DESC
    LIMIT 10
  `);
  console.table(r.rows ?? r);
})();

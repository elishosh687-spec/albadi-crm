import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  const r = await db.execute(sql`
    SELECT evt_id, type, tenant, payload
    FROM bridge_events
    WHERE evt_id = 'evt_01KRHJN3CKBEJ8M09T281GC0GX'
  `);
  for (const row of r.rows ?? []) {
    console.log(JSON.stringify(row, null, 2));
  }
})();

import "dotenv/config";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

(async () => {
  const r = await db.execute(sql`
    SELECT 'leads' AS t, COUNT(*)::int AS n FROM leads
    UNION ALL SELECT 'lead_tags', COUNT(*)::int FROM lead_tags
    UNION ALL SELECT 'messages', COUNT(*)::int FROM messages
    UNION ALL SELECT 'bridge_events', COUNT(*)::int FROM bridge_events
  `);
  console.table(r.rows ?? r);
})();

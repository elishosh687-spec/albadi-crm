import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function main() {
  const r = await db.execute(sql`
    SELECT id, trigger, mode, intent, buying_signal, goal,
           (draft_text IS NOT NULL) AS has_draft,
           validation->>'ok' AS valid, created_at
    FROM setter_decisions ORDER BY id DESC LIMIT 8`);
  for (const row of (r as any).rows) console.log(JSON.stringify(row));
}
main().then(() => process.exit(0));

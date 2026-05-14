import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== leads with activity in last 2h ===");
  const r = await db.execute(sql`
    SELECT manychat_sub_id, name, phone_e164, wa_jid, pipeline_stage, q_state, bot_paused, updated_at
    FROM leads
    WHERE updated_at > NOW() - INTERVAL '2 hours'
    ORDER BY updated_at DESC
  `);
  for (const row of r.rows) {
    console.log("  -", JSON.stringify(row, null, 0));
  }

  console.log("\n=== last 25 messages ===");
  const m = await db.execute(sql`
    SELECT manychat_sub_id, direction, sender, received_at, text
    FROM messages
    WHERE received_at > NOW() - INTERVAL '2 hours'
    ORDER BY received_at DESC
    LIMIT 25
  `);
  for (const row of m.rows) {
    console.log("  -", row.received_at, "sub=" + row.manychat_sub_id, row.direction, "sender=" + row.sender, "|", String(row.text || "").slice(0, 80).replace(/\n/g, " "));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

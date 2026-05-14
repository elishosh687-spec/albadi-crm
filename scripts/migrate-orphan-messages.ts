import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const apply = process.argv.includes("--apply");

  // Find messages keyed by a JID that matches a lead's waJid. Those should
  // be rewritten to use the lead's canonical manychat_sub_id so dashboard
  // groupings resolve to the right conversation/lead row.
  const preview = await db.execute(sql`
    SELECT m.manychat_sub_id AS msg_key, l.manychat_sub_id AS lead_sid, l.name, COUNT(*)::int AS n
    FROM messages m
    JOIN leads l ON l.wa_jid = m.manychat_sub_id
    WHERE m.manychat_sub_id <> l.manychat_sub_id
    GROUP BY m.manychat_sub_id, l.manychat_sub_id, l.name
    ORDER BY n DESC
  `);
  console.log("orphan groups to migrate:", preview.rows.length);
  let total = 0;
  for (const r of preview.rows) {
    console.log("  -", r.msg_key, "→", JSON.stringify(r.lead_sid), "name=" + r.name, "n=" + r.n);
    total += Number(r.n);
  }
  console.log("total messages:", total);

  if (!apply) {
    console.log("\n[DRY] not migrating. re-run with --apply.");
    process.exit(0);
  }

  const res = await db.execute(sql`
    UPDATE messages m
    SET manychat_sub_id = l.manychat_sub_id
    FROM leads l
    WHERE l.wa_jid = m.manychat_sub_id
      AND m.manychat_sub_id <> l.manychat_sub_id
  `);
  console.log("migrated:", (res as any).rowCount ?? "?");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

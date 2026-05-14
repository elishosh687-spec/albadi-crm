import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const apply = process.argv.includes("--apply");

  // Dead JIDs = "<digits>@s.whatsapp.net" where digits are a ManyChat sub_id,
  // not an IL phone. IL phones start with 972; ManyChat sub_ids do not.
  const candidates = await db.execute(sql`
    SELECT manychat_sub_id, COUNT(*)::int AS n
    FROM messages
    WHERE manychat_sub_id ~ '^[0-9]+@s\\.whatsapp\\.net$'
      AND manychat_sub_id NOT LIKE '972%'
    GROUP BY manychat_sub_id
    ORDER BY n DESC
  `);
  console.log("dead JID groups:", candidates.rows.length);
  let total = 0;
  for (const r of candidates.rows) {
    console.log("  -", r.manychat_sub_id, "→", r.n, "messages");
    total += Number(r.n);
  }
  console.log("total messages:", total);

  if (!apply) {
    console.log("\n[DRY] not deleting. re-run with --apply.");
    process.exit(0);
  }

  const res = await db.execute(sql`
    DELETE FROM messages
    WHERE manychat_sub_id ~ '^[0-9]+@s\\.whatsapp\\.net$'
      AND manychat_sub_id NOT LIKE '972%'
  `);
  console.log("deleted:", (res as any).rowCount ?? "?");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const apply = process.argv.includes("--apply");

  const dirty = await db.execute(sql`
    SELECT manychat_sub_id, trim(manychat_sub_id) AS clean, name
    FROM leads
    WHERE manychat_sub_id <> trim(manychat_sub_id)
    ORDER BY name
  `);
  console.log("leads with whitespace in sid:", dirty.rows.length);
  for (const r of dirty.rows) {
    console.log("  -", JSON.stringify(r.manychat_sub_id), "→", JSON.stringify(r.clean), "name=" + r.name);
  }

  if (!apply) {
    console.log("\n[DRY] not changing. re-run with --apply.");
    process.exit(0);
  }

  // Rewrite each dirty sid + dependents.
  for (const r of dirty.rows) {
    const dirtySid = String(r.manychat_sub_id);
    const cleanSid = String(r.clean);
    await db.execute(sql`UPDATE messages SET manychat_sub_id = ${cleanSid} WHERE manychat_sub_id = ${dirtySid}`);
    await db.execute(sql`UPDATE lead_tags SET manychat_sub_id = ${cleanSid} WHERE manychat_sub_id = ${dirtySid}`);
    await db.execute(sql`UPDATE bot_drafts SET manychat_sub_id = ${cleanSid} WHERE manychat_sub_id = ${dirtySid}`);
    await db.execute(sql`UPDATE leads SET manychat_sub_id = ${cleanSid} WHERE manychat_sub_id = ${dirtySid}`);
  }
  console.log("trimmed:", dirty.rows.length, "leads.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

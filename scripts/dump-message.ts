import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const waId = process.argv[2] || "3EB03FEE6B8AF489E72120";
  const r = await db.execute(sql`
    SELECT manychat_sub_id, sender, direction, received_at, text
    FROM messages
    WHERE wa_message_id = ${waId}
  `);
  for (const row of r.rows) {
    console.log("--- sub=" + row.manychat_sub_id, "sender=" + row.sender, "dir=" + row.direction, "at=" + row.received_at + " ---");
    console.log(row.text);
    console.log("---END---");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

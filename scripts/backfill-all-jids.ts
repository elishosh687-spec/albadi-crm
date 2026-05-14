import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const dry = process.argv.includes("--dry");

  const preview = await db.execute(sql`
    SELECT manychat_sub_id, name, phone_e164, wa_jid
    FROM leads
    WHERE wa_jid IS NULL
      AND phone_e164 IS NOT NULL
      AND phone_e164 <> ''
    LIMIT 200
  `);
  console.log("candidates (waJid NULL + phone present):", preview.rows.length);
  for (const r of preview.rows.slice(0, 20)) {
    console.log("  -", r.manychat_sub_id, "phone=" + r.phone_e164, "name=" + r.name);
  }

  if (dry) {
    console.log("\n[DRY] not updating. re-run without --dry to apply.");
    process.exit(0);
  }

  const res = await db.execute(sql`
    UPDATE leads
    SET wa_jid = regexp_replace(phone_e164, '[^0-9]', '', 'g') || '@s.whatsapp.net',
        updated_at = NOW()
    WHERE wa_jid IS NULL
      AND phone_e164 IS NOT NULL
      AND phone_e164 <> ''
  `);
  console.log("updated rows:", (res as any).rowCount ?? "?");

  const remaining = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM leads
    WHERE wa_jid IS NULL AND (phone_e164 IS NULL OR phone_e164 = '')
  `);
  console.log("leads still without waJid AND without phone:", remaining.rows[0]);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Scratch: list all GHL custom fields and estimate usage by scanning contacts.
 * Run: DATABASE_URL="$(...)" npx tsx scripts/_ghl-custom-fields-audit.ts
 */
import { db } from "../lib/db";
import { sql as dsql } from "drizzle-orm";

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

async function main() {
  const r: any = await db.execute(
    dsql`SELECT access_token, location_id FROM ghl_oauth_tokens ORDER BY updated_at DESC LIMIT 1`
  );
  const row = (r.rows ?? r)[0];
  const token = row.access_token;
  const locationId = row.location_id;

  const headers = {
    Authorization: `Bearer ${token}`,
    Version: VERSION,
    Accept: "application/json",
  };

  // 1. List all custom fields
  const cfRes = await fetch(
    `${BASE}/locations/${locationId}/customFields`,
    { headers }
  );
  if (!cfRes.ok) {
    console.error("customFields fetch failed:", cfRes.status, await cfRes.text());
    return;
  }
  const cfJson: any = await cfRes.json();
  const fields: any[] = cfJson.customFields ?? [];
  console.log(`\n=== ${fields.length} custom fields total ===\n`);

  // map fieldKey -> meta
  const byKey = new Map<string, any>();
  for (const f of fields) {
    byKey.set(f.id, { name: f.name, fieldKey: f.fieldKey, dataType: f.dataType, count: 0 });
  }

  // 2. Scan contacts, count non-empty values per field id
  let totalContacts = 0;
  let page = 1;
  let startAfter: string | undefined;
  let startAfterId: string | undefined;
  // GHL v2 contacts search via /contacts/?locationId=...&limit=100
  while (true) {
    const url = new URL(`${BASE}/contacts/`);
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("limit", "100");
    if (startAfter) url.searchParams.set("startAfter", startAfter);
    if (startAfterId) url.searchParams.set("startAfterId", startAfterId);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error("contacts fetch failed:", res.status, await res.text());
      break;
    }
    const j: any = await res.json();
    const contacts: any[] = j.contacts ?? [];
    if (contacts.length === 0) break;
    for (const c of contacts) {
      totalContacts++;
      const cfs: any[] = c.customFields ?? c.customField ?? [];
      for (const cf of cfs) {
        const id = cf.id;
        const val = cf.value ?? cf.field_value;
        const nonEmpty = Array.isArray(val) ? val.length > 0 : val !== undefined && val !== null && String(val).trim() !== "";
        if (nonEmpty && byKey.has(id)) byKey.get(id).count++;
      }
    }
    const meta = j.meta ?? {};
    startAfter = meta.startAfter;
    startAfterId = meta.startAfterId;
    page++;
    if (!startAfter && !startAfterId) break;
    if (page > 200) break; // safety
  }

  console.log(`Scanned ${totalContacts} contacts across ${page - 1} pages\n`);

  const rows = [...byKey.values()].sort((a, b) => a.count - b.count);
  console.log("USED count | dataType | name | fieldKey");
  console.log("-----------|----------|------|--------");
  for (const row of rows) {
    console.log(
      `${String(row.count).padStart(6)} | ${String(row.dataType).padEnd(12)} | ${row.name} | ${row.fieldKey}`
    );
  }

  const unused = rows.filter((r) => r.count === 0);
  console.log(`\n=== ${unused.length} fields with ZERO usage across scanned contacts ===`);
  for (const u of unused) console.log(`  - ${u.name}  (${u.fieldKey}, ${u.dataType})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

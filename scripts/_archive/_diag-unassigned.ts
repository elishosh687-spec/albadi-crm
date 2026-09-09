/**
 * READ-ONLY diagnostic: how many GHL contacts/opportunities have no owner
 * (assignedTo), and who the available users are (to find Itay). No writes.
 */
import { neon } from "@neondatabase/serverless";

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT access_token, location_id FROM ghl_oauth_tokens
    ORDER BY updated_at DESC LIMIT 1
  `) as { access_token: string; location_id: string }[];
  const token = rows[0].access_token;
  const locationId = rows[0].location_id;
  console.log("locationId:", locationId);

  const h = {
    Authorization: `Bearer ${token}`,
    Version: VERSION,
    Accept: "application/json",
  };

  // --- Users in the location (find Itay) ---
  const ures = await fetch(`${BASE}/users/?locationId=${locationId}`, { headers: h });
  const ujson = await ures.json();
  const users = (ujson.users ?? []) as any[];
  console.log(`\n=== USERS (${users.length}) ===`);
  for (const u of users) {
    console.log(`  ${u.id}  ${u.name ?? `${u.firstName ?? ""} ${u.lastName ?? ""}`}  <${u.email ?? ""}>`);
  }

  // --- Opportunities: paginate, inspect assignedTo ---
  const pipelineId = process.env.GHL_PIPELINE_ID || "JG6rSzAxvlK4gROZ6Ot0";
  let startAfter: string | undefined;
  let startAfterId: string | undefined;
  const opps: any[] = [];
  for (let page = 0; page < 50; page++) {
    const u = new URL(`${BASE}/opportunities/search`);
    u.searchParams.set("location_id", locationId);
    u.searchParams.set("pipeline_id", pipelineId);
    u.searchParams.set("limit", "100");
    if (startAfter) u.searchParams.set("startAfter", startAfter);
    if (startAfterId) u.searchParams.set("startAfterId", startAfterId);
    const r = await fetch(u.toString(), { headers: h });
    if (!r.ok) { console.error("opp search failed", r.status, await r.text()); break; }
    const j = await r.json();
    const batch = (j.opportunities ?? []) as any[];
    opps.push(...batch);
    const meta = j.meta ?? {};
    if (!batch.length || !meta.startAfterId) break;
    startAfter = meta.startAfter;
    startAfterId = meta.startAfterId;
  }

  const openOpps = opps.filter((o) => o.status === "open");
  const unassignedAll = opps.filter((o) => !o.assignedTo);
  const unassignedOpen = openOpps.filter((o) => !o.assignedTo);
  console.log(`\n=== OPPORTUNITIES ===`);
  console.log(`  total: ${opps.length}`);
  console.log(`  open:  ${openOpps.length}`);
  console.log(`  unassigned (all statuses): ${unassignedAll.length}`);
  console.log(`  unassigned (open only):    ${unassignedOpen.length}`);

  // breakdown of assignedTo values
  const byOwner = new Map<string, number>();
  for (const o of opps) {
    const k = o.assignedTo || "(none)";
    byOwner.set(k, (byOwner.get(k) ?? 0) + 1);
  }
  console.log(`\n  owner breakdown:`);
  for (const [k, n] of [...byOwner.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${n.toString().padStart(4)}  ${k}`);
  }

  console.log(`\n  sample unassigned-open (first 8):`);
  for (const o of unassignedOpen.slice(0, 8)) {
    console.log(`    ${o.id}  contact=${o.contactId}  name=${o.name ?? o.contact?.name ?? ""}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

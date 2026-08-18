/**
 * Backfill: assign every UNASSIGNED GHL lead (opportunity + its contact) to
 * Itay. Read-only by default. Modes:
 *   (no flag)  dry-run — list what would change, write nothing.
 *   --test     write exactly ONE (opp + contact) to verify the API shape.
 *   --go       write ALL unassigned.
 *
 * Only touches records where assignedTo is empty — never stomps an existing
 * owner (the 17 already on Itay, or anything hand-assigned).
 */
import { neon } from "@neondatabase/serverless";

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
const ITAY = "jTt6f6zPALPW2XVKVqok";

const MODE = process.argv.includes("--go")
  ? "go"
  : process.argv.includes("--test")
    ? "test"
    : "dry";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT access_token, location_id FROM ghl_oauth_tokens
    ORDER BY updated_at DESC LIMIT 1
  `) as { access_token: string; location_id: string }[];
  const token = rows[0].access_token;
  const locationId = rows[0].location_id;
  const pipelineId = process.env.GHL_PIPELINE_ID || "JG6rSzAxvlK4gROZ6Ot0";
  const h = {
    Authorization: `Bearer ${token}`,
    Version: VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Pull all opps in the pipeline.
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

  const targets = opps.filter((o) => !o.assignedTo);
  console.log(`MODE=${MODE}  total opps=${opps.length}  unassigned=${targets.length}`);

  const list = MODE === "test" ? targets.slice(0, 1) : targets;
  let oppOk = 0, oppFail = 0, ctOk = 0, ctFail = 0;

  for (const o of list) {
    if (MODE === "dry") {
      console.log(`  would assign  opp=${o.id}  contact=${o.contactId}  name=${o.name ?? ""}  status=${o.status}`);
      continue;
    }
    // 1) opportunity owner — preserve pipeline/stage/name/status, only add owner.
    try {
      const body: Record<string, unknown> = {
        pipelineId,
        assignedTo: ITAY,
      };
      if (o.pipelineStageId) body.pipelineStageId = o.pipelineStageId;
      if (o.name) body.name = o.name;
      if (o.status) body.status = o.status;
      const r = await fetch(`${BASE}/opportunities/${o.id}`, {
        method: "PUT", headers: h, body: JSON.stringify(body),
      });
      if (r.ok) { oppOk++; } else { oppFail++; console.error(`  opp ${o.id} FAIL ${r.status} ${(await r.text()).slice(0,200)}`); }
    } catch (e) { oppFail++; console.error(`  opp ${o.id} ERR`, e); }

    // 2) contact owner.
    if (o.contactId) {
      try {
        const r = await fetch(`${BASE}/contacts/${o.contactId}`, {
          method: "PUT", headers: h, body: JSON.stringify({ assignedTo: ITAY }),
        });
        if (r.ok) { ctOk++; } else { ctFail++; console.error(`  contact ${o.contactId} FAIL ${r.status} ${(await r.text()).slice(0,200)}`); }
      } catch (e) { ctFail++; console.error(`  contact ${o.contactId} ERR`, e); }
    }
    if (MODE === "test") console.log(`  TEST wrote opp=${o.id} contact=${o.contactId}`);
  }

  if (MODE !== "dry") {
    console.log(`\nDONE  opp: ${oppOk} ok / ${oppFail} fail   contact: ${ctOk} ok / ${ctFail} fail`);
  } else {
    console.log(`\n(dry-run — nothing written. Run with --test to write ONE, then --go for all.)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

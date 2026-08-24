/**
 * Migrate opportunity.albadi_lead_score -> contact.albadi_lead_score.
 *
 * Re-reads live from GHL every run (never hardcodes ids). If one contact has
 * several scored opportunities, the most-recently-updated one wins — same rule
 * as reconcileStagesFromGhl.
 *
 * Safe to re-run: a contact already holding the same value is skipped.
 * Dry by default; pass --go to write.
 */
import { neon } from "@neondatabase/serverless";

const sqlc = neon(process.env.DATABASE_URL!);
const BASE = "https://services.leadconnectorhq.com";
const GO = process.argv.includes("--go");

const OPP_FIELD_ID = "gNojMCZVszE5m2k8jvXh"; // opportunity.albadi_lead_score
const CONTACT_FIELD_ID = "zneBwsG0dSB3ajj8lnjv"; // contact.albadi_lead_score
const VALID = new Set(["HOT", "WARM", "COLD"]);

async function creds() {
  const rows = (await sqlc`
    SELECT access_token, location_id FROM ghl_oauth_tokens
    ORDER BY updated_at DESC LIMIT 1
  `) as Array<{ access_token: string; location_id: string }>;
  return { token: rows[0].access_token, locationId: rows[0].location_id };
}

async function gfetch<T = any>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`GHL ${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

function readCf(cfs: any[], id: string): string | null {
  const f = (cfs ?? []).find((c) => c.id === id);
  if (!f) return null;
  const raw = f.fieldValueString ?? f.fieldValueArray ?? f.fieldValue ?? f.value ?? null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || null;
}

async function main() {
  const { token, locationId } = await creds();

  // 1. Collect every opportunity carrying a score.
  const opps: any[] = [];
  for (let page = 1; page <= 40; page++) {
    const r = await gfetch<any>(
      token,
      `/opportunities/search?location_id=${locationId}&limit=100&page=${page}`
    );
    const batch = r.opportunities ?? [];
    opps.push(...batch);
    if (batch.length < 100) break;
  }

  const scored = opps
    .map((o) => ({
      oppId: o.id,
      name: o.name,
      contactId: o.contactId ?? o.contact?.id ?? null,
      value: readCf(o.customFields, OPP_FIELD_ID),
      updatedAt: o.updatedAt ?? "",
    }))
    .filter((o) => o.value && o.contactId);

  console.log(`Scanned ${opps.length} opportunities; ${scored.length} carry a score.`);

  // 2. Newest-updated opportunity wins per contact.
  const byContact = new Map<string, (typeof scored)[number]>();
  for (const s of scored) {
    const prev = byContact.get(s.contactId!);
    if (!prev || String(s.updatedAt) > String(prev.updatedAt)) {
      byContact.set(s.contactId!, s);
    }
  }
  console.log(`Distinct contacts to migrate: ${byContact.size}\n`);

  const plan: Array<{ contactId: string; name: string; from: string | null; to: string }> = [];
  for (const [contactId, s] of byContact) {
    const val = s.value!.toUpperCase();
    if (!VALID.has(val)) {
      console.log(`  SKIP ${contactId} — unexpected value ${JSON.stringify(s.value)}`);
      continue;
    }
    const c = await gfetch<any>(token, `/contacts/${contactId}`);
    const current = readCf(c.contact?.customFields ?? [], CONTACT_FIELD_ID);
    if (current === val) {
      console.log(`  OK   ${contactId} (${s.name}) already = ${val}`);
      continue;
    }
    plan.push({ contactId, name: s.name, from: current, to: val });
  }

  console.log(`\nPlanned writes: ${plan.length}`);
  for (const p of plan) {
    console.log(`  ${p.contactId} (${p.name}): ${p.from ?? "(empty)"} -> ${p.to}`);
  }

  if (!GO) {
    console.log("\nDRY RUN — pass --go to write.");
    return;
  }

  let ok = 0;
  for (const p of plan) {
    await gfetch(token, `/contacts/${p.contactId}`, {
      method: "PUT",
      body: JSON.stringify({
        customFields: [{ id: CONTACT_FIELD_ID, field_value: p.to }],
      }),
    });
    // Verify by re-reading.
    const after = await gfetch<any>(token, `/contacts/${p.contactId}`);
    const got = readCf(after.contact?.customFields ?? [], CONTACT_FIELD_ID);
    const good = got === p.to;
    if (good) ok++;
    console.log(`  ${good ? "WROTE" : "FAILED"} ${p.contactId} -> ${got ?? "(empty)"}`);
  }
  console.log(`\n${ok}/${plan.length} verified.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

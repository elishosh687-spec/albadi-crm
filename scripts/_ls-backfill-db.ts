/**
 * Mirror contact.albadi_lead_score -> leads.albadi_lead_score for every DB lead
 * that has a ghl_contact_id, exercising the SAME code path the resync webhook
 * uses (GHL_FIELD_IDS -> fieldKeyForId -> normalizeAlbadiLeadScore) so this
 * doubles as an end-to-end test of the new wiring.
 *
 * Dry by default; --go to write. --all sweeps every lead (slow, ~350 calls);
 * default sweeps only leads whose contact is known to carry a value.
 */
import { neon } from "@neondatabase/serverless";
import { GHL_FIELD_IDS } from "../integrations/ghl/config";
import { normalizeAlbadiLeadScore } from "../lib/ghl/albadi-lead-score";

const sqlc = neon(process.env.DATABASE_URL!);
const BASE = "https://services.leadconnectorhq.com";
const GO = process.argv.includes("--go");
const ALL = process.argv.includes("--all");

async function creds() {
  const rows = (await sqlc`
    SELECT access_token, location_id FROM ghl_oauth_tokens
    ORDER BY updated_at DESC LIMIT 1
  `) as Array<{ access_token: string; location_id: string }>;
  return { token: rows[0].access_token, locationId: rows[0].location_id };
}

async function gfetch<T = any>(token: string, path: string): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GHL GET ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** Same shape as resync-helper's private fieldKeyForId. */
function fieldKeyForId(id: string): string | null {
  for (const [key, v] of Object.entries(GHL_FIELD_IDS)) if (v === id) return key;
  return null;
}

async function main() {
  const { token, locationId } = await creds();
  console.log(
    `GHL_FIELD_IDS.albadi_lead_score = ${GHL_FIELD_IDS.albadi_lead_score || "(UNSET!)"}`
  );
  console.log(`GHL_FIELD_IDS.lead_score = ${GHL_FIELD_IDS.lead_score ?? "(removed)"}\n`);

  const dbLeads = (await sqlc`
    SELECT manychat_sub_id AS sid, name, ghl_contact_id, albadi_lead_score
    FROM leads WHERE ghl_contact_id IS NOT NULL
  `) as Array<{
    sid: string;
    name: string | null;
    ghl_contact_id: string;
    albadi_lead_score: string | null;
  }>;
  console.log(`DB leads with a GHL contact: ${dbLeads.length}`);

  // Narrow the sweep unless --all: find contacts carrying a value by walking
  // the opportunities (cheap, paged) and taking their contactIds, plus any
  // lead that already has a DB value (so a cleared score is mirrored too).
  let targets = dbLeads;
  if (!ALL) {
    const contactIds = new Set<string>();
    for (let page = 1; page <= 40; page++) {
      const r = await gfetch<any>(
        token,
        `/opportunities/search?location_id=${locationId}&limit=100&page=${page}`
      );
      const batch = r.opportunities ?? [];
      for (const o of batch) {
        const cid = o.contactId ?? o.contact?.id;
        if (cid) contactIds.add(cid);
      }
      if (batch.length < 100) break;
    }
    // Still 300+ — so instead just check leads that either already hold a value
    // or belong to the migrated set. Pass --all for a full sweep.
    const migrated = new Set([
      "ZMOX2GKQyLR1Mm851uUT",
      "mt3insJRh9HtA5pLb8fS",
      "vCcjtg7sttC2vhg3xcGL",
    ]);
    targets = dbLeads.filter(
      (l) => migrated.has(l.ghl_contact_id) || l.albadi_lead_score
    );
  }
  console.log(`Checking ${targets.length} lead(s)${ALL ? " (full sweep)" : ""}\n`);

  const plan: Array<{ sid: string; name: string | null; from: string | null; to: string | null }> = [];
  for (const l of targets) {
    let contact: any;
    try {
      const r = await gfetch<any>(token, `/contacts/${l.ghl_contact_id}`);
      contact = r.contact;
    } catch (e) {
      console.log(`  ERR ${l.sid} -> ${(e as Error).message.slice(0, 120)}`);
      continue;
    }
    const cf: Record<string, unknown> = {};
    for (const f of contact.customFields ?? []) {
      const key = fieldKeyForId(f.id);
      if (key) cf[key] = f.value;
    }
    const to = normalizeAlbadiLeadScore(cf.albadi_lead_score);
    if ((l.albadi_lead_score ?? null) !== to) {
      plan.push({ sid: l.sid, name: l.name, from: l.albadi_lead_score, to });
    } else {
      console.log(`  OK  ${l.sid} (${l.name}) = ${to ?? "(null)"}`);
    }
  }

  console.log(`\nPlanned DB updates: ${plan.length}`);
  for (const p of plan) {
    console.log(`  ${p.sid} (${p.name}): ${p.from ?? "(null)"} -> ${p.to ?? "(null)"}`);
  }
  if (!GO) {
    console.log("\nDRY RUN — pass --go to write.");
    return;
  }
  for (const p of plan) {
    await sqlc`UPDATE leads SET albadi_lead_score = ${p.to} WHERE manychat_sub_id = ${p.sid}`;
  }
  const dist = await sqlc`
    SELECT COALESCE(albadi_lead_score, '(null)') AS score, COUNT(*)::int AS n
    FROM leads GROUP BY 1 ORDER BY 2 DESC
  `;
  console.log("\nDB distribution after:", JSON.stringify(dist));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

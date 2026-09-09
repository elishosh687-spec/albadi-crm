/**
 * End-to-end test of the live pipeline:
 *   set contact.albadi_lead_score in GHL
 *     -> native ContactUpdate app-webhook
 *       -> resyncContact -> normalizeAlbadiLeadScore
 *         -> leads.albadi_lead_score
 *
 * Uses a LOST/inactive lead whose score is currently empty, sets WARM (the band
 * with no production coverage yet), polls the DB, then clears the field back to
 * empty. Net effect on real data: none.
 */
import { neon } from "@neondatabase/serverless";

const sqlc = neon(process.env.DATABASE_URL!);
const BASE = "https://services.leadconnectorhq.com";
const CONTACT_FIELD_ID = "zneBwsG0dSB3ajj8lnjv";
const GO = process.argv.includes("--go");

async function creds() {
  const rows = (await sqlc`
    SELECT access_token FROM ghl_oauth_tokens ORDER BY updated_at DESC LIMIT 1
  `) as Array<{ access_token: string }>;
  return rows[0].access_token;
}

async function gfetch<T = any>(token: string, path: string, init: RequestInit = {}): Promise<T> {
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
  if (!res.ok) throw new Error(`GHL ${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const token = await creds();

  const [target] = (await sqlc`
    SELECT manychat_sub_id AS sid, name, ghl_contact_id, albadi_lead_score
    FROM leads
    WHERE ghl_contact_id IS NOT NULL
      AND albadi_lead_score IS NULL
      AND pipeline_stage = 'LOST'
    ORDER BY updated_at ASC NULLS LAST
    LIMIT 1
  `) as Array<{ sid: string; name: string | null; ghl_contact_id: string; albadi_lead_score: string | null }>;

  if (!target) {
    console.log("no suitable LOST lead found");
    return;
  }
  console.log(`target: ${target.sid} (${target.name}) contact=${target.ghl_contact_id}`);
  console.log(`DB score before: ${target.albadi_lead_score ?? "(null)"}`);
  if (!GO) {
    console.log("\nDRY RUN — pass --go to run the round trip.");
    return;
  }

  // 1. Write WARM in GHL.
  console.log("\n-> setting WARM in GHL ...");
  await gfetch(token, `/contacts/${target.ghl_contact_id}`, {
    method: "PUT",
    body: JSON.stringify({ customFields: [{ id: CONTACT_FIELD_ID, field_value: "WARM" }] }),
  });

  // 2. Poll the DB for the webhook to land.
  let mirrored: string | null = null;
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const [row] = (await sqlc`
      SELECT albadi_lead_score AS s FROM leads WHERE manychat_sub_id = ${target.sid}
    `) as Array<{ s: string | null }>;
    mirrored = row?.s ?? null;
    console.log(`   t+${(i + 1) * 3}s  DB = ${mirrored ?? "(null)"}`);
    if (mirrored === "WARM") break;
  }

  console.log(
    mirrored === "WARM"
      ? "\n✅ PASS — GHL -> webhook -> DB mirrored WARM"
      : "\n❌ FAIL — DB never received WARM"
  );

  // 3. Clear it back so real data is untouched.
  console.log("\n-> clearing the field back to empty ...");
  await gfetch(token, `/contacts/${target.ghl_contact_id}`, {
    method: "PUT",
    body: JSON.stringify({ customFields: [{ id: CONTACT_FIELD_ID, field_value: "" }] }),
  });
  const after = await gfetch<any>(token, `/contacts/${target.ghl_contact_id}`);
  const cf = (after.contact?.customFields ?? []).find((f: any) => f.id === CONTACT_FIELD_ID);
  console.log(`   GHL now = ${JSON.stringify(cf?.value ?? null)}`);

  for (let i = 0; i < 10; i++) {
    await sleep(3000);
    const [row] = (await sqlc`
      SELECT albadi_lead_score AS s FROM leads WHERE manychat_sub_id = ${target.sid}
    `) as Array<{ s: string | null }>;
    console.log(`   t+${(i + 1) * 3}s  DB = ${row?.s ?? "(null)"}`);
    if (!row?.s) break;
  }
  // Belt and braces: the field must end empty in DB too.
  await sqlc`UPDATE leads SET albadi_lead_score = NULL WHERE manychat_sub_id = ${target.sid}`;
  console.log("\ncleanup done — lead restored to no score");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

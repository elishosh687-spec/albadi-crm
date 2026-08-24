/**
 * Create the CONTACT custom field "Albadi Lead Score" (RADIO, HOT/WARM/COLD,
 * no custom option). Idempotent: if a contact field with that name already
 * exists it is reported and NOT recreated.
 *
 * Dry by default. Pass --go to actually create.
 */
import { neon } from "@neondatabase/serverless";

const sqlc = neon(process.env.DATABASE_URL!);
const BASE = "https://services.leadconnectorhq.com";
const GO = process.argv.includes("--go");

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
    throw new Error(`GHL ${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 600)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function main() {
  const { token, locationId } = await creds();

  const existing = await gfetch<any>(
    token,
    `/locations/${locationId}/customFields?model=contact`
  );
  const found = (existing.customFields ?? []).find(
    (f: any) => String(f.name).trim().toLowerCase() === "albadi lead score"
  );
  if (found) {
    console.log("ALREADY EXISTS — not creating again:");
    console.log(JSON.stringify(found, null, 2));
    return;
  }

  const body = {
    name: "Albadi Lead Score",
    dataType: "RADIO",
    model: "contact",
    placeholder: "",
    options: ["HOT", "WARM", "COLD"],
  };

  console.log("Would POST /locations/<loc>/customFields:");
  console.log(JSON.stringify(body, null, 2));
  if (!GO) {
    console.log("\nDRY RUN — pass --go to create.");
    return;
  }

  const created = await gfetch<any>(token, `/locations/${locationId}/customFields`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  console.log("\nCREATED:");
  console.log(JSON.stringify(created, null, 2));

  // Read back to confirm what GHL actually stored.
  const after = await gfetch<any>(
    token,
    `/locations/${locationId}/customFields?model=contact`
  );
  const row = (after.customFields ?? []).find(
    (f: any) => String(f.name).trim().toLowerCase() === "albadi lead score"
  );
  console.log("\nREAD BACK:");
  console.log(JSON.stringify(row, null, 2));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

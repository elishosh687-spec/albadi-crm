/**
 * Post-test cleanup + comprehensive audit:
 *   1. Delete the old GHL contact (VLgMRMz8Ow68Rm2p0Jck) so the new lead
 *      isn't shadowed by the stale contact.
 *   2. Verify the freshly imported lead landed correctly.
 *   3. Print the current GOOGLE_SHEETS_FB_LEADS_ID env var name + module path
 *      so the user knows what to update.
 */
import { db } from "../lib/db";
import { leads, ghlOauthTokens } from "../drizzle/schema";
import { sql, eq, desc, gte } from "drizzle-orm";

const OLD_GHL_CONTACT_ID = "VLgMRMz8Ow68Rm2p0Jck";

async function getGhlAccess() {
  const row = await db
    .select({
      accessToken: ghlOauthTokens.accessToken,
      locationId: ghlOauthTokens.locationId,
      expiresAt: ghlOauthTokens.expiresAt,
    })
    .from(ghlOauthTokens)
    .orderBy(desc(ghlOauthTokens.updatedAt))
    .limit(1);
  return row[0];
}

async function deleteGhlContact(token: string, contactId: string) {
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  return { status: res.status, body: await res.text() };
}

async function lookupGhlContact(token: string, contactId: string) {
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  return { status: res.status, body: await res.text() };
}

async function main() {
  console.log("\n=== 1. Delete stale GHL contact ===");
  const auth = await getGhlAccess();
  if (!auth) {
    console.log("  ⚠️  No ghl_oauth_tokens row — can't call GHL API.");
  } else {
    const expired = new Date(auth.expiresAt) < new Date();
    console.log(`  using location=${auth.locationId}  token-expires=${new Date(auth.expiresAt).toISOString().slice(0, 16)}  ${expired ? "(EXPIRED)" : "(valid)"}`);

    const lookup = await lookupGhlContact(auth.accessToken, OLD_GHL_CONTACT_ID);
    if (lookup.status === 404) {
      console.log(`  ✅ GHL contact ${OLD_GHL_CONTACT_ID} already gone (404)`);
    } else if (lookup.status === 401 || lookup.status === 403) {
      console.log(`  ⚠️  Auth issue (${lookup.status}). Body: ${lookup.body.slice(0, 200)}`);
    } else if (lookup.status === 200) {
      console.log(`  ⚠️  contact STILL EXISTS — user must delete via GHL UI`);
      try {
        const parsed = JSON.parse(lookup.body);
        console.log(`     name: ${parsed?.contact?.contactName ?? parsed?.contact?.firstName ?? "—"}  phone: ${parsed?.contact?.phone ?? "—"}`);
      } catch {}
    } else {
      console.log(`  unexpected lookup status ${lookup.status}: ${lookup.body.slice(0, 200)}`);
    }
  }

  console.log("\n=== 2. Fresh lead audit ===");
  const since = new Date(Date.now() - 30 * 60 * 1000);
  const fresh = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      source: leads.source,
      leadSource: leads.leadSource,
      ghlId: leads.ghlContactId,
      stage: leads.pipelineStage,
      created: leads.createdAt,
    })
    .from(leads)
    .where(gte(leads.createdAt, since))
    .orderBy(desc(leads.createdAt));
  console.log(`  leads created in last 30min: ${fresh.length}`);
  for (const l of fresh) {
    console.log(
      `    ${new Date(l.created).toISOString().slice(11, 16)}  ${(l.name ?? "—").padEnd(15)} ${l.phone}  src=${l.source}  leadSrc=${l.leadSource ?? "—"}  ghl=${l.ghlId ?? "—"}  stage=${l.stage ?? "—"}`,
    );
  }

  console.log("\n=== 3. Sheet env var status (for dashboard pill) ===");
  const sheetEnv = process.env.GOOGLE_SHEETS_FB_LEADS_ID ?? "(not set in this process)";
  console.log(`  GOOGLE_SHEETS_FB_LEADS_ID (local): ${sheetEnv ? `set, len=${sheetEnv.length}` : "empty"}`);
  console.log(`  module: lib/sheets/lead-gaps.ts (reads via CSV — sheet must be 'Anyone with link can view')`);
  console.log(`  new sheet id (target): 1AnswoeBAFV-z4aN3KhqyJjb9DegyiDNH-0FcB8ry518`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

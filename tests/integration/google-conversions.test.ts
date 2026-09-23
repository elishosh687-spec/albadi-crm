/**
 * The daily CRM → Google offline-conversion run on a throwaway Neon branch
 * (2026-09-23). The Data Manager API is simulated through the injected fetch —
 * nothing reaches Google. Applies migrations 0005–0007 first (idempotent).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ciSid, purgeSid, sql } from "./_db";
import { runGoogleConversions } from "@/lib/google/conversions-run";
import { _resetTokenCache, type FetchFn } from "@/lib/google/ads-client";

const SID = ciSid("g-conv");
const ENV = { GOOGLE_ADS_CLIENT_ID: "c", GOOGLE_ADS_CLIENT_SECRET: "s", GOOGLE_DATAMANAGER_REFRESH_TOKEN: "dm", GOOGLE_ADS_CUSTOMER_ID: "6763920913" };
const NOW = new Date();

async function apply(file: string) {
  for (const stmt of readFileSync(join(process.cwd(), "drizzle/migrations", file), "utf8").split("--> statement-breakpoint")) {
    const body = stmt.replace(/^\s*--.*$/gm, "").trim();
    if (body) await sql(body);
  }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
let bodies: any[] = [];
const google = (ok = true): FetchFn => async (url, init) => {
  if (url.includes("oauth2")) return json(200, { access_token: "DM", expires_in: 3600 });
  bodies.push(JSON.parse(String(init?.body)));
  return ok ? json(200, { requestId: "req-ci" }) : json(400, { error: { message: "invalid gclid" } });
};
const row = async () => (await sql(`SELECT * FROM leads WHERE manychat_sub_id = $1`, [SID]))[0] as any;

beforeAll(async () => {
  for (const f of ["0005_google_click_attribution.sql", "0006_google_click_campaign.sql", "0007_google_conversions.sql"]) await apply(f);
  await purgeSid(SID);
  await sql(
    `INSERT INTO leads (manychat_sub_id, name, source, lead_source, created_at, google_gclid, pipeline_stage, email, phone_e164)
     VALUES ($1, 'CI Conv', 'website_import', 'google', now() - interval '2 days', 'CjwKCAjw-ci-conv', 'CONSIDERATION', 'ci@example.com', '972500007306')`,
    [SID],
  );
});
beforeEach(() => {
  bodies = [];
  _resetTokenCache();
});
afterAll(async () => {
  await purgeSid(SID);
});

describe("runGoogleConversions", () => {
  it("validate mode: Google checks both events, nothing is stamped", async () => {
    const r = await runGoogleConversions({ fetchFn: google(), env: { ...ENV, GOOGLE_CONVERSIONS_MODE: "validate" }, includeTestLeads: true, now: NOW });
    expect(r).toMatchObject({ mode: "validate", validated: 2, sent: 0, failed: 0 });
    expect(bodies.every((b) => b.validateOnly === true)).toBe(true);
    expect(bodies.map((b) => b.destinations[0].productDestinationId)).toEqual(["7711834479", "7711834482"]);
    const l = await row();
    expect(l.google_qualified_sent_at).toBeNull();
  });

  it("live, Google refuses → error recorded, nothing stamped", async () => {
    const r = await runGoogleConversions({ fetchFn: google(false), env: { ...ENV, GOOGLE_CONVERSIONS_MODE: "live" }, includeTestLeads: true, now: NOW });
    expect(r.failed).toBe(2);
    const l = await row();
    expect(l.google_conversion_error).toContain("invalid gclid");
    expect(l.google_quote_sent_at).toBeNull();
  });

  it("live, accepted → stamped, error cleared; the next run sends nothing", async () => {
    const r = await runGoogleConversions({ fetchFn: google(), env: { ...ENV, GOOGLE_CONVERSIONS_MODE: "live" }, includeTestLeads: true, now: NOW });
    expect(r).toMatchObject({ sent: 2, failed: 0 });
    expect(bodies.every((b) => b.validateOnly === false)).toBe(true);
    const l = await row();
    expect(l.google_qualified_sent_at).not.toBeNull();
    expect(l.google_quote_sent_at).not.toBeNull();
    expect(l.google_conversion_error).toBeNull();

    bodies = [];
    const again = await runGoogleConversions({ fetchFn: google(), env: { ...ENV, GOOGLE_CONVERSIONS_MODE: "live" }, includeTestLeads: true, now: NOW });
    expect(again.pending).toEqual({ qualified: 0, quote: 0, purchase: 0 });
    expect(bodies).toHaveLength(0);
  });

  it("off → nothing at all", async () => {
    const r = await runGoogleConversions({ fetchFn: google(), env: { ...ENV, GOOGLE_CONVERSIONS_MODE: "off" }, includeTestLeads: true });
    expect(r.mode).toBe("off");
    expect(bodies).toHaveLength(0);
  });
});

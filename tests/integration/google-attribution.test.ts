/**
 * The daily Google attribution run on a throwaway Neon branch (2026-09-23).
 * Google is simulated through the injected fetch — nothing reaches Google Ads.
 * Applies migrations 0005 + 0006 first (idempotent).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ciSid, purgeSid, sql } from "./_db";
import { runGoogleAttribution } from "@/lib/google/attribution-run";
import { _resetTokenCache, type FetchFn } from "@/lib/google/ads-client";

const CLICK = ciSid("g-click");
const UTM = ciSid("g-utm");
const LOST = ciSid("g-lost");
const GCLID = "CjwKCAjwCI-click-found";
const GCLID_LOST = "CjwKCAjwCI-click-lost";

async function apply(file: string) {
  for (const stmt of readFileSync(join(process.cwd(), "drizzle/migrations", file), "utf8").split("--> statement-breakpoint")) {
    const body = stmt.replace(/^\s*--.*$/gm, "").trim();
    if (body) await sql(body);
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const googleCalls: string[] = [];
const fakeGoogle: FetchFn = async (url, init) => {
  if (url.includes("oauth2")) return json({ access_token: "AT", expires_in: 3600 });
  const q = String(JSON.parse(String(init?.body)).query);
  googleCalls.push(q);
  if (q.includes(GCLID) && q.includes("'2026-09-20'")) {
    return json([{ results: [{
      clickView: { gclid: GCLID, keywordInfo: { text: "תיק אל בד", matchType: "PHRASE" } },
      segments: { date: "2026-09-20" },
      campaign: { id: "24116271526", name: "אלבדי | Search | שקיות אלבד" },
      adGroup: { id: "187000000001", name: "שקיות אלבד" },
    }] }]);
  }
  if (q.includes("FROM ad_group WHERE ad_group.id = 187000000002")) {
    return json([{ results: [{ adGroup: { id: "187000000002", name: "שקיות ממותגות" }, campaign: { id: "24116271526", name: "אלבדי | Search | שקיות אלבד" } }] }]);
  }
  return json([]);
};

async function seed(sid: string, createdAt: string, cols: Record<string, string>) {
  const keys = Object.keys(cols);
  await sql(
    `INSERT INTO leads (manychat_sub_id, name, source, lead_source, created_at, ${keys.join(", ")})
     VALUES ($1, 'CI Google', 'website_import', 'google', $2, ${keys.map((_, i) => `$${i + 3}`).join(", ")})`,
    [sid, createdAt, ...keys.map((k) => cols[k])],
  );
}
const get = async (sid: string) => (await sql(`SELECT * FROM leads WHERE manychat_sub_id = $1`, [sid]))[0] as any;

beforeAll(async () => {
  Object.assign(process.env, {
    GOOGLE_ADS_DEVELOPER_TOKEN: "ci", GOOGLE_ADS_CLIENT_ID: "ci", GOOGLE_ADS_CLIENT_SECRET: "ci", GOOGLE_ADS_REFRESH_TOKEN: "ci-refresh",
  });
  _resetTokenCache();
  await apply("0005_google_click_attribution.sql");
  await apply("0006_google_click_campaign.sql");
  // Keep only our three rows in play: every other pending row on the branch is
  // stamped out of the run's reach for the duration of the test.
  await sql(`UPDATE leads SET google_attributed_at = now() WHERE google_attributed_at IS NULL AND manychat_sub_id NOT LIKE 'test:ci-%'`);
  for (const s of [CLICK, UTM, LOST]) await purgeSid(s);
  await seed(CLICK, "2026-09-21T10:00:00Z", { google_gclid: GCLID });
  await seed(UTM, "2026-09-21T10:00:00Z", { google_gbraid: "0AAAAAgbraid-ci", utm_content: "187000000002", utm_term: "שקיות עם לוגו" });
  await seed(LOST, "2026-09-10T10:00:00Z", { google_gclid: GCLID_LOST });
});
afterAll(async () => {
  for (const s of [CLICK, UTM, LOST]) await purgeSid(s);
});

describe("runGoogleAttribution", () => {
  it("click_view match, utm fallback, and not_found after 3 days", async () => {
    const r = await runGoogleAttribution({ fetchFn: fakeGoogle, now: new Date("2026-09-23T12:00:00Z") });
    expect(r).toMatchObject({ clickView: 1, utm: 1, notFound: 1, retryLater: 0 });

    const c = await get(CLICK);
    expect(c.google_attribution).toBe("click_view");
    expect(c.google_campaign_id).toBe("24116271526");
    expect(c.google_ad_group_name).toBe("שקיות אלבד");
    expect(c.google_keyword).toBe("תיק אל בד");
    expect(c.google_match_type).toBe("PHRASE");
    expect(c.google_click_date).toBe("2026-09-20");

    const u = await get(UTM);
    expect(u.google_attribution).toBe("utm");
    expect(u.google_ad_group_name).toBe("שקיות ממותגות");
    expect(u.google_keyword).toBe("שקיות עם לוגו");

    expect((await get(LOST)).google_attribution).toBe("not_found");
    expect(googleCalls.every((q) => q.trim().startsWith("SELECT"))).toBe(true);
  });

  it("a second run touches nothing", async () => {
    googleCalls.length = 0;
    const r = await runGoogleAttribution({ fetchFn: fakeGoogle, now: new Date("2026-09-23T12:00:00Z") });
    expect(r.candidates).toBe(0);
    expect(googleCalls).toHaveLength(0);
  });
});

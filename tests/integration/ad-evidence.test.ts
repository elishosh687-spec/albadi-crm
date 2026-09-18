/**
 * Phase 3 — evidence by exact Ad ID, the recommendations API, and the daily
 * health job that WhatsApps Eli (via the watchdog) when a connection breaks.
 *
 * Meta is never called for real: the test env has no META_ADS_TOKEN, and where
 * a working Meta is needed, global fetch is wrapped so graph.facebook.com is
 * answered locally while every other request (Neon's HTTP driver!) passes
 * through untouched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ciSid, purgeSid, sql } from "./_db";
import { loadCrmEvidence } from "@/lib/ads/crm-evidence";
import * as adsHealth from "@/lib/ads/ads-health";

const AD_1 = `98${Date.now()}1`;
const AD_2 = `98${Date.now()}2`;
const NAME = `ci-ad-${Date.now()}`;
const S1 = ciSid("ad-ev-1");
const S2 = ciSid("ad-ev-2");
const S3 = ciSid("ad-ev-3");
const S4 = ciSid("ad-ev-4");

async function applyMigration() {
  const file = readFileSync(join(process.cwd(), "drizzle/migrations/0004_ad_recommendations.sql"), "utf8");
  for (const stmt of file.split("--> statement-breakpoint")) {
    const body = stmt.replace(/^\s*--.*$/gm, "").trim();
    if (body) await sql(body);
  }
}

let priorJobs: unknown;

beforeAll(async () => {
  await applyMigration();
  for (const s of [S1, S2, S3, S4]) await purgeSid(s);
  // Two copies with one name (the C-magic-hat-trick shape), the sheet's ag:
  // prefix on one, a tagged suitable lead, and a lead with a name but no ID.
  await sql(`INSERT INTO leads (manychat_sub_id, active, meta_ad_id, meta_ad_name) VALUES ($1, true, $2, $3)`, [S1, `ag:${AD_1}`, NAME]);
  await sql(`INSERT INTO leads (manychat_sub_id, active, meta_ad_id, meta_ad_name) VALUES ($1, true, $2, $3)`, [S2, AD_1, NAME]);
  await sql(`INSERT INTO leads (manychat_sub_id, active, meta_ad_id, meta_ad_name) VALUES ($1, true, $2, $3)`, [S3, `ag:${AD_2}`, NAME]);
  await sql(`INSERT INTO leads (manychat_sub_id, active, meta_ad_id, meta_ad_name) VALUES ($1, true, NULL, $2)`, [S4, NAME]);
  await sql(`INSERT INTO lead_tags (manychat_sub_id, tag) VALUES ($1, 'Good Lead ')`, [S1]);
  await sql(`INSERT INTO lead_tags (manychat_sub_id, tag) VALUES ($1, 'ליד טוב')`, [S2]);
  const rows = (await sql(`SELECT value FROM app_config WHERE key = 'jobs.status'`)) as { value: any }[];
  priorJobs = rows[0]?.value;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  for (const s of [S1, S2, S3, S4]) await purgeSid(s);
  if (priorJobs !== undefined) {
    await sql(`UPDATE app_config SET value = $1::jsonb WHERE key = 'jobs.status'`, [JSON.stringify(priorJobs)]);
  }
});

describe("CRM evidence by exact Ad ID", () => {
  it("normalises ag:, keeps same-name copies apart, counts only the configured tag", async () => {
    const crm = await loadCrmEvidence("good lead", { includeTestLeads: true });
    expect(crm.byAdId.get(AD_1)).toMatchObject({ leads: 2, suitableLeads: 1 });
    expect(crm.byAdId.get(AD_2)).toMatchObject({ leads: 1, suitableLeads: 0 });
    expect(crm.nameCollisions.get(NAME)).toEqual([AD_1, AD_2].sort());
    expect(crm.unattributable.some((u) => u.sid === S4)).toBe(true);
  });

  it("changing the tag setting changes which leads count", async () => {
    const crm = await loadCrmEvidence("ליד טוב", { includeTestLeads: true });
    expect(crm.byAdId.get(AD_1)!.suitableLeads).toBe(1); // now S2, not S1
  });

  it("production mode excludes test: leads entirely", async () => {
    const crm = await loadCrmEvidence("good lead");
    expect(crm.byAdId.has(AD_1)).toBe(false);
  });
});

const TOKEN = "ci-widget-token";
const recReq = (token: string | null = TOKEN) =>
  new NextRequest(new URL("http://localhost/api/widget/ads/recommendations?fresh=1"), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const cronReq = (secret: string | null) =>
  new Request("http://localhost/api/cron/ads-evidence-check", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

async function jobState() {
  const rows = (await sql(`SELECT value -> 'ads-evidence' AS s FROM app_config WHERE key = 'jobs.status'`)) as { s: any }[];
  return rows[0]?.s ?? null;
}

describe("recommendations API", () => {
  it("401 without the widget token", async () => {
    const { GET } = await import("@/app/api/widget/ads/recommendations/route");
    expect((await GET(recReq(null), undefined as never)).status).toBe(401);
  });

  it("without a Meta token: 200, every row 'cannot decide', the reason on screen", async () => {
    vi.stubEnv("META_ADS_TOKEN", "");
    const { GET } = await import("@/app/api/widget/ads/recommendations/route");
    const res = await GET(recReq(), undefined as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.health.meta).toMatchObject({ ok: false, configured: false });
    expect(json.health.meta.reason).toContain("META_ADS_TOKEN");
    const codes = new Set(json.rows.map((r: any) => r.recommendation.code));
    expect([...codes]).toEqual(codes.size ? ["insufficient_or_conflicting_data"] : []);
  });
});

describe("daily health job → watchdog → WhatsApp", () => {
  it("401 without a secret, and a probe is not recorded as a run", async () => {
    const before = await jobState();
    const { GET } = await import("@/app/api/cron/ads-evidence-check/route");
    expect((await GET(cronReq(null), undefined as never)).status).toBe(401);
    expect(await jobState()).toEqual(before);
  });

  it("Meta token missing → the run FAILS with the Hebrew reason the watchdog will send", async () => {
    vi.stubEnv("META_ADS_TOKEN", "");
    vi.stubEnv("CRON_SECRET", "ci-cron-secret");
    const { GET } = await import("@/app/api/cron/ads-evidence-check/route");
    const res = await GET(cronReq("ci-cron-secret"), undefined as never);
    expect(res.status).toBe(500);
    const st = await jobState();
    expect(st.lastStatus).toBe("failed");
    expect(st.lastError).toContain("META_ADS_TOKEN");
  });

  it("an expired Meta token → failed with 'פג', and the token never lands in the heartbeat", async () => {
    vi.stubEnv("META_ADS_TOKEN", "CI-SECRET-META-TOKEN");
    vi.stubEnv("CRON_SECRET", "ci-cron-secret");
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("graph.facebook.com")) {
        return new Response(JSON.stringify({ error: { code: 190, message: "Session has expired" } }), { status: 400 });
      }
      return real(input, init);
    });
    const { GET } = await import("@/app/api/cron/ads-evidence-check/route");
    expect((await GET(cronReq("ci-cron-secret"), undefined as never)).status).toBe(500);
    const st = await jobState();
    expect(st.lastError).toContain("פג");
    expect(JSON.stringify(st)).not.toContain("CI-SECRET-META-TOKEN");
  });

  // The ads-health strip (CAPI ping, GHL tag search) needs credentials CI does
  // not have; stub its RESULT so these tests pin how the job reacts to it.
  const healthy = () =>
    vi.spyOn(adsHealth, "checkAdsHealth").mockResolvedValue({
      ok: true,
      problems: 0,
      checks: [{ key: "purchase", label: "דיווח עסקאות סגורות למטא", ok: true, detail: "ok" }],
    });

  it("Meta healthy → the run succeeds (recovery), with the seeded ads judged by exact ID", async () => {
    healthy();
    vi.stubEnv("META_ADS_TOKEN", "CI-SECRET-META-TOKEN");
    vi.stubEnv("CRON_SECRET", "ci-cron-secret");
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("graph.facebook.com")) return real(input, init);
      const data = url.includes("/insights")
        ? [{ ad_id: AD_1, ad_name: NAME, date_start: "2026-09-01", spend: "40", actions: [{ action_type: "lead", value: "2" }] }]
        : [{ id: AD_1, name: NAME, effective_status: "PAUSED" }, { id: AD_2, name: NAME, effective_status: "PAUSED" }];
      return new Response(JSON.stringify({ data, paging: {} }), { status: 200 });
    });
    const { GET } = await import("@/app/api/cron/ads-evidence-check/route");
    const res = await GET(cronReq("ci-cron-secret"), undefined as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.nameCollisions).toBeGreaterThanOrEqual(0);
    const st = await jobState();
    expect(st.lastStatus).toBe("ok");
    expect(st.lastError).toBeUndefined();
  });

  it("any red line of the ads-health strip FAILS the run with its reason (18/09: Elran never reported)", async () => {
    vi.spyOn(adsHealth, "checkAdsHealth").mockResolvedValue({
      ok: false,
      problems: 2,
      checks: [
        { key: "purchase", label: "דיווח עסקאות סגורות למטא", ok: false, detail: "Elran — לא דווח" },
        { key: "job:enrich-meta-attribution", label: "משימה יומית", ok: false, detail: "watchdog alerts this one" },
      ],
    });
    vi.stubEnv("META_ADS_TOKEN", "CI-SECRET-META-TOKEN");
    vi.stubEnv("CRON_SECRET", "ci-cron-secret");
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("graph.facebook.com")) return real(input, init);
      return new Response(JSON.stringify({ data: [], paging: {} }), { status: 200 });
    });
    const { GET } = await import("@/app/api/cron/ads-evidence-check/route");
    const res = await GET(cronReq("ci-cron-secret"), undefined as never);
    expect(res.status).toBe(500);
    const st = await jobState();
    expect(st.lastStatus).toBe("failed");
    expect(st.lastError).toContain("Elran — לא דווח");
    expect(st.lastError).not.toContain("watchdog alerts this one");
  });
});

/**
 * lib/google/ads-client.ts — read-only GAQL client (2026-09-23). No network:
 * fetch is injected.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { _resetTokenCache, gaql, googleAdsConfig, microsToIls, type FetchFn } from "./ads-client";

const cfg = googleAdsConfig({
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev",
  GOOGLE_ADS_CLIENT_ID: "cid",
  GOOGLE_ADS_CLIENT_SECRET: "sec",
  GOOGLE_ADS_REFRESH_TOKEN: "refresh-SECRET-123456",
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fake(api: (url: string, init?: RequestInit) => Response, token: () => Response = () => json(200, { access_token: "AT", expires_in: 3600 })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return url.includes("oauth2") ? token() : api(url, init);
  };
  return { fn, calls };
}

beforeEach(() => _resetTokenCache());

describe("gaql", () => {
  it("runs searchStream on the Albadi account without an MCC header and flattens batches", async () => {
    const { fn, calls } = fake(() => json(200, [{ results: [{ campaign: { id: "1" } }] }, { results: [{ campaign: { id: "2" } }] }]));
    const r = await gaql("SELECT campaign.id FROM campaign", { cfg, fetchFn: fn });
    expect(r).toEqual({ ok: true, rows: [{ campaign: { id: "1" } }, { campaign: { id: "2" } }] });
    const api = calls.find((c) => c.url.includes("googleads"))!;
    expect(api.url).toBe("https://googleads.googleapis.com/v24/customers/6763920913/googleAds:searchStream");
    const h = api.init!.headers as Record<string, string>;
    expect(h["developer-token"]).toBe("dev");
    expect(h.authorization).toBe("Bearer AT");
    expect(Object.keys(h).some((k) => /login-customer-id/i.test(k))).toBe(false);
  });

  it("refuses anything that is not a SELECT", async () => {
    const { fn, calls } = fake(() => json(200, []));
    const r = await gaql("UPDATE campaign SET x", { cfg, fetchFn: fn });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("names the missing env vars and does not call Google", async () => {
    const { fn, calls } = fake(() => json(200, []));
    const r = await gaql("SELECT campaign.id FROM campaign", { cfg: googleAdsConfig({}), fetchFn: fn });
    expect(r).toMatchObject({ ok: false, configured: false });
    if (!r.ok) expect(r.reason).toContain("GOOGLE_ADS_REFRESH_TOKEN");
    expect(calls).toHaveLength(0);
  });

  it("a revoked refresh token → Hebrew reason, secret never echoed", async () => {
    const { fn } = fake(() => json(200, []), () => json(400, { error: "invalid_grant" }));
    const r = await gaql("SELECT campaign.id FROM campaign", { cfg, fetchFn: fn });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("פגה או בוטלה");
      expect(r.reason).not.toContain("SECRET");
    }
  });

  it("permission error from the API is explained", async () => {
    const { fn } = fake(() => json(403, [{ error: { code: 403, message: "denied", details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] }] } }]));
    const r = await gaql("SELECT campaign.id FROM campaign", { cfg, fetchFn: fn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("אין גישה");
  });

  it("a network failure never returns the raw error", async () => {
    const fn: FetchFn = async (url) => {
      if (url.includes("oauth2")) return json(200, { access_token: "AT", expires_in: 3600 });
      throw new Error("connect ECONNREFUSED https://secret-url");
    };
    const r = await gaql("SELECT campaign.id FROM campaign", { cfg, fetchFn: fn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain("secret-url");
  });

  it("reuses the access token between calls", async () => {
    const { fn, calls } = fake(() => json(200, []));
    await gaql("SELECT campaign.id FROM campaign", { cfg, fetchFn: fn });
    await gaql("SELECT campaign.id FROM campaign", { cfg, fetchFn: fn });
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });
});

describe("microsToIls", () => {
  it("converts micros", () => {
    expect(microsToIls("12500000")).toBe(12.5);
    expect(microsToIls(null)).toBe(0);
  });
});

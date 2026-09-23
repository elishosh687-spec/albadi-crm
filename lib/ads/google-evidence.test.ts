/**
 * lib/ads/google-evidence.ts — fold of Google's rows (real searchStream JSON
 * shapes) and the all-or-nothing snapshot (2026-09-23).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fetchGoogleEvidence, foldGoogleEvidence, sumDays } from "./google-evidence";
import { _resetTokenCache, googleAdsConfig, type FetchFn } from "@/lib/google/ads-client";

const SEARCH = { id: "24116271526", name: "אלבדי | Search | שקיות אלבד", status: "PAUSED", advertisingChannelType: "SEARCH" };
const PMAX = { id: "24281545388", name: "אלבדי | PMax", status: "PAUSED", advertisingChannelType: "PERFORMANCE_MAX" };

describe("foldGoogleEvidence", () => {
  const out = foldGoogleEvidence(
    [{ campaign: SEARCH }, { campaign: PMAX }],
    [
      { campaign: SEARCH, segments: { date: "2026-09-01" }, metrics: { costMicros: "20000000", clicks: "6", impressions: "90", conversions: 1 } },
      { campaign: SEARCH, segments: { date: "2026-08-31" }, metrics: { costMicros: "46040000", clicks: "10" } },
    ],
    [{ campaign: SEARCH, adGroup: { id: "187", name: "שקיות אלבד", status: "ENABLED" }, segments: { date: "2026-08-31" }, metrics: { costMicros: "30000000", clicks: "7" } }],
  );

  it("lists a campaign that never spent (PMax) with its status", () => {
    expect(out.get(PMAX.id)).toMatchObject({ status: "PAUSED", channel: "PERFORMANCE_MAX", daily: [] });
  });

  it("micros → ₪, days sorted, ad groups nested", () => {
    const s = out.get(SEARCH.id)!;
    expect(s.daily.map((d) => d.date)).toEqual(["2026-08-31", "2026-09-01"]);
    expect(s.daily[0].costIls).toBeCloseTo(46.04);
    expect(s.adGroups.get("187")?.daily[0]).toMatchObject({ costIls: 30, clicks: 7 });
  });

  it("sumDays respects the period", () => {
    const s = out.get(SEARCH.id)!;
    expect(sumDays(s.daily, null).clicks).toBe(16);
    expect(sumDays(s.daily, "2026-09-01")).toMatchObject({ costIls: 20, clicks: 6, conversions: 1 });
  });
});

describe("fetchGoogleEvidence", () => {
  const cfg = googleAdsConfig({ GOOGLE_ADS_DEVELOPER_TOKEN: "d", GOOGLE_ADS_CLIENT_ID: "c", GOOGLE_ADS_CLIENT_SECRET: "s", GOOGLE_ADS_REFRESH_TOKEN: "r" });
  beforeEach(() => _resetTokenCache());
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("one failed read → the whole snapshot is unavailable, with the reason", async () => {
    const fn: FetchFn = async (url, init) => {
      if (url.includes("oauth2")) return json(200, { access_token: "A", expires_in: 3600 });
      const q = String(JSON.parse(String(init?.body)).query);
      return q.includes("FROM ad_group") ? json(429, [{ error: { message: "slow down" } }]) : json(200, [{ results: [] }]);
    };
    const s = await fetchGoogleEvidence({ cfg, fetchFn: fn, today: "2026-09-23" });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toContain("קצב");
  });

  it("reads only SELECTs, from the history start to today", async () => {
    const qs: string[] = [];
    const fn: FetchFn = async (url, init) => {
      if (url.includes("oauth2")) return json(200, { access_token: "A", expires_in: 3600 });
      qs.push(String(JSON.parse(String(init?.body)).query));
      return json(200, [{ results: [] }]);
    };
    const s = await fetchGoogleEvidence({ cfg, fetchFn: fn, today: "2026-09-23", historyStart: "2026-08-01" });
    expect(s.ok).toBe(true);
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => q.trim().startsWith("SELECT"))).toBe(true);
    expect(qs.filter((q) => q.includes("BETWEEN '2026-08-01' AND '2026-09-23'"))).toHaveLength(2);
  });
});

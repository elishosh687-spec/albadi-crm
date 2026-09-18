import { describe, expect, it } from "vitest";
import { dateWindows, fetchMetaEvidence, foldMetaRows, leadsFromActions, type MetaConfig } from "./meta-evidence";

const CFG: MetaConfig = { token: "SECRET-TOKEN", accountId: "act_1", version: "v26.0", historyStart: "2026-09-01" };

/** A fake Graph API: routes by path, serves pages, records every URL asked. */
function fakeGraph(routes: Record<string, any[] | ((url: URL) => { status: number; body: any })>) {
  const calls: string[] = [];
  const fetchFn = async (raw: string) => {
    calls.push(raw);
    const url = new URL(raw);
    const page = Number(url.searchParams.get("page") ?? 0);
    const key = Object.keys(routes).find((k) => url.pathname.endsWith(k))!;
    const route = routes[key];
    if (typeof route === "function") {
      const r = route(url);
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    const pages = route;
    const next = page + 1 < pages.length ? (() => { const u = new URL(url); u.searchParams.set("page", String(page + 1)); return u.toString(); })() : undefined;
    return new Response(JSON.stringify({ data: pages[page], paging: next ? { next } : {} }), { status: 200 });
  };
  return { fetchFn, calls };
}

describe("leadsFromActions", () => {
  it("counts action_type=lead only, never the sum of the array", () => {
    expect(
      leadsFromActions([
        { action_type: "lead", value: "3" },
        { action_type: "onsite_conversion.lead_grouped", value: "3" },
        { action_type: "link_click", value: "40" },
      ]),
    ).toBe(3);
    expect(leadsFromActions(undefined)).toBe(0);
    expect(leadsFromActions([{ action_type: "link_click", value: "9" }])).toBe(0);
  });
});

describe("dateWindows", () => {
  it("covers the range in ≤90-day inclusive windows, no gap, no overlap", () => {
    const w = dateWindows("2026-01-01", "2026-09-18");
    expect(w[0]).toEqual(["2026-01-01", "2026-03-31"]);
    expect(w[1][0]).toBe("2026-04-01");
    expect(w.at(-1)![1]).toBe("2026-09-18");
    expect(dateWindows("2026-09-18", "2026-09-18")).toEqual([["2026-09-18", "2026-09-18"]]);
  });
});

describe("foldMetaRows", () => {
  it("keeps same-name copies apart by Ad ID and sorts days", () => {
    const m = foldMetaRows(
      [
        { ad_id: "2", ad_name: "C-magic", adset_id: "20", date_start: "2026-09-02", spend: "5", actions: [{ action_type: "lead", value: "1" }] },
        { ad_id: "1", ad_name: "C-magic", adset_id: "10", date_start: "2026-09-02", spend: "7.5" },
        { ad_id: "1", ad_name: "C-magic", adset_id: "10", date_start: "2026-09-01", spend: "2.5", actions: [{ action_type: "lead", value: "2" }] },
      ],
      [{ id: "1", name: "C-magic", adset_id: "10", adset: { name: "form" }, effective_status: "ACTIVE" }, { id: "3", name: "never-ran", effective_status: "PAUSED" }],
    );
    expect([...m.keys()].sort()).toEqual(["1", "2", "3"]);
    expect(m.get("1")!.daily).toEqual([
      { date: "2026-09-01", spendIls: 2.5, metaLeads: 2 },
      { date: "2026-09-02", spendIls: 7.5, metaLeads: 0 },
    ]);
    expect(m.get("1")!.adSetName).toBe("form");
    expect(m.get("1")!.effectiveStatus).toBe("ACTIVE");
    expect(m.get("3")!.daily).toEqual([]);
  });
});

describe("fetchMetaEvidence", () => {
  it("no token → unavailable, not configured, and no request is made", async () => {
    const g = fakeGraph({});
    const s = await fetchMetaEvidence({ today: "2026-09-18", config: { ...CFG, token: "" }, fetchFn: g.fetchFn });
    expect(s).toMatchObject({ ok: false, configured: false });
    expect(g.calls).toHaveLength(0);
  });

  it("follows every paging.next and merges pages", async () => {
    const g = fakeGraph({
      "/insights": [
        [{ ad_id: "1", ad_name: "a", date_start: "2026-09-01", spend: "10", actions: [{ action_type: "lead", value: "1" }] }],
        [{ ad_id: "1", ad_name: "a", date_start: "2026-09-02", spend: "20", actions: [{ action_type: "lead", value: "2" }] }],
      ],
      "/ads": [[{ id: "1", name: "a", effective_status: "ACTIVE" }]],
    });
    const s = await fetchMetaEvidence({ today: "2026-09-18", config: CFG, fetchFn: g.fetchFn });
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.rows).toBe(2);
      expect(s.pages).toBe(3);
      expect(s.ads.get("1")!.daily.map((d) => d.spendIls)).toEqual([10, 20]);
    }
    const insightsUrl = new URL(g.calls[0]);
    expect(insightsUrl.searchParams.get("time_increment")).toBe("1");
    expect(insightsUrl.searchParams.get("level")).toBe("ad");
    expect(JSON.parse(insightsUrl.searchParams.get("time_range")!)).toEqual({ since: "2026-09-01", until: "2026-09-18" });
  });

  it("a failed page makes the WHOLE snapshot unavailable, with a Hebrew reason and no token", async () => {
    const g = fakeGraph({
      "/insights": (url) =>
        url.searchParams.get("page") === "1"
          ? { status: 400, body: { error: { code: 190, message: "Error validating access token: Session has expired" } } }
          : { status: 200, body: { data: [{ ad_id: "1", date_start: "2026-09-01", spend: "1" }], paging: { next: `${url.toString()}&page=1` } } },
      "/ads": [[]],
    });
    const s = await fetchMetaEvidence({ today: "2026-09-18", config: CFG, fetchFn: g.fetchFn });
    expect(s).toMatchObject({ ok: false, configured: true });
    if (!s.ok) {
      expect(s.reason).toContain("פג");
      expect(s.reason).not.toContain("SECRET-TOKEN");
    }
  });

  it("a network error never leaks the URL (which carries the token)", async () => {
    const fetchFn = async (url: string) => {
      throw new TypeError(`fetch failed for ${url}`);
    };
    const s = await fetchMetaEvidence({ today: "2026-09-18", config: CFG, fetchFn });
    expect(s.ok).toBe(false);
    expect(JSON.stringify(s)).not.toContain("SECRET-TOKEN");
  });

  it("permission errors and rate limits get their own explanation", async () => {
    for (const [code, word] of [[200, "ads_read"], [17, "קצב"]] as const) {
      const g = fakeGraph({ "/insights": () => ({ status: 400, body: { error: { code, message: "x" } } }), "/ads": [[]] });
      const s = await fetchMetaEvidence({ today: "2026-09-18", config: CFG, fetchFn: g.fetchFn });
      expect(!s.ok && s.reason).toContain(word);
    }
  });
});

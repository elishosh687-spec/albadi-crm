/**
 * lib/google/attribution.ts — pure rules for tying a lead's click to a Google
 * campaign / ad group / keyword (2026-09-23). Row shapes are the real
 * searchStream JSON seen on the Albadi account.
 */
import { describe, expect, it } from "vitest";
import {
  adGroupIdFromUtm,
  candidateClickDates,
  clickViewQuery,
  fromAdGroupRow,
  fromClickRow,
  israelDate,
  safeClickId,
} from "./attribution";

describe("dates", () => {
  it("uses the Israel calendar day, not UTC", () => {
    // 22:30 UTC on 31/08 is already 01/09 in Israel (UTC+3).
    expect(israelDate(new Date("2026-08-31T22:30:00Z"))).toBe("2026-09-01");
  });
  it("the lead's day and the two before it, newest first", () => {
    expect(candidateClickDates(new Date("2026-09-01T09:00:00Z"))).toEqual(["2026-09-01", "2026-08-31", "2026-08-30"]);
  });
});

describe("safeClickId", () => {
  it("accepts a real-looking gclid", () => {
    expect(safeClickId("CjwKCAjwzNTU-BhA_EiwA")).toBe("CjwKCAjwzNTU-BhA_EiwA");
  });
  it("refuses anything that could break out of the GAQL string", () => {
    expect(safeClickId("abc' OR 1=1 --xxxx")).toBeNull();
    expect(safeClickId(null)).toBeNull();
  });
});

describe("adGroupIdFromUtm", () => {
  it("numeric ad group id only", () => {
    expect(adGroupIdFromUtm("187654321012")).toBe("187654321012");
    expect(adGroupIdFromUtm("{adgroupid}")).toBeNull();
    expect(adGroupIdFromUtm("banner-a")).toBeNull();
  });
});

describe("row mapping", () => {
  it("click_view row → campaign, ad group, keyword, match type, date", () => {
    const row = {
      clickView: { gclid: "CjwKCAjw", keywordInfo: { text: "תיק אל בד", matchType: "PHRASE" } },
      segments: { date: "2026-08-31" },
      campaign: { id: "24116271526", name: "אלבדי | Search | שקיות אלבד" },
      adGroup: { id: "187000000001", name: "שקיות אלבד" },
    };
    expect(fromClickRow(row)).toEqual({
      campaignId: "24116271526",
      campaignName: "אלבדי | Search | שקיות אלבד",
      adGroupId: "187000000001",
      adGroupName: "שקיות אלבד",
      keyword: "תיק אל בד",
      matchType: "PHRASE",
      clickDate: "2026-08-31",
      source: "click_view",
    });
  });

  it("PMax click has a campaign and nothing below it", () => {
    const a = fromClickRow({ campaign: { id: "24281545388", name: "PMax" }, segments: { date: "2026-10-01" }, clickView: {} });
    expect(a.campaignId).toBe("24281545388");
    expect(a.adGroupId).toBeNull();
    expect(a.keyword).toBeNull();
  });

  it("utm fallback takes names from the ad group and the keyword from utm_term", () => {
    const a = fromAdGroupRow({ adGroup: { id: "187", name: "שקיות ממותגות" }, campaign: { id: "241", name: "Search" } }, " שקיות עם לוגו ");
    expect(a).toMatchObject({ source: "utm", adGroupName: "שקיות ממותגות", keyword: "שקיות עם לוגו", clickDate: null });
  });
});

describe("clickViewQuery", () => {
  it("filters one day and one gclid", () => {
    const q = clickViewQuery("CjwKCAjwzNTU", "2026-08-31");
    expect(q).toContain("segments.date = '2026-08-31'");
    expect(q).toContain("click_view.gclid = 'CjwKCAjwzNTU'");
    expect(q.trim().startsWith("SELECT")).toBe(true);
  });
});

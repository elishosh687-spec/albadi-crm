/**
 * lib/ads/google-performance.ts — the fold behind "גוגל ← קמפיינים" (2026-09-23).
 */
import { describe, expect, it } from "vitest";
import { foldGooglePerformance, type GoogleLeadRow } from "./google-performance";
import { foldGoogleEvidence, type GoogleSnapshot } from "./google-evidence";
import { GOOGLE_DEFAULTS_2026_09_23 as S } from "./google-settings";

const SEARCH = { id: "241", name: "Search", status: "ENABLED", advertisingChannelType: "SEARCH" };
const PMAX = { id: "242", name: "PMax", status: "PAUSED", advertisingChannelType: "PERFORMANCE_MAX" };

const snap: GoogleSnapshot = {
  ok: true,
  fetchedAt: "2026-09-23T00:00:00Z",
  historyStart: "2026-08-01",
  campaigns: foldGoogleEvidence(
    [{ campaign: SEARCH }, { campaign: PMAX }],
    [
      { campaign: SEARCH, segments: { date: "2026-08-20" }, metrics: { costMicros: "300000000", clicks: "40" } },
      { campaign: SEARCH, segments: { date: "2026-09-10" }, metrics: { costMicros: "100000000", clicks: "10" } },
    ],
    [{ campaign: SEARCH, adGroup: { id: "a1", name: "שקיות אלבד" }, segments: { date: "2026-09-10" }, metrics: { costMicros: "100000000", clicks: "10" } }],
  ),
};

const lead = (sid: string, p: Partial<GoogleLeadRow> = {}): GoogleLeadRow => ({
  sid, name: sid, campaignId: "241", campaignName: "Search", adGroupId: "a1", adGroupName: "שקיות אלבד",
  keyword: "תיק אל בד", matchType: "PHRASE", attribution: "click_view", suitable: false, engaged: false, viaWhatsApp: false, ...p,
});

describe("foldGooglePerformance", () => {
  const r = foldGooglePerformance(
    [lead("l1", { suitable: true, name: "דנה | 050" }), lead("l2"), lead("w1", { campaignId: null, viaWhatsApp: true }), lead("n1", { campaignId: null, attribution: "not_found" })],
    [{ sid: "l1", customerName: "דנה בע״מ", totalExVat: 8000 }],
    snap,
    S,
    null,
  );
  const search = r.rows.find((x) => x.id === "241")!;

  it("per campaign: leads, suitable, deals, revenue, spend, CPL, CAC, profit after ads", () => {
    expect(search).toMatchObject({ leads: 2, suitable: 1, won: 1, revenueIls: 8000, spendIls: 400, clicks: 50, cplIls: 200, cacIls: 400, profitAfterAdsIls: 1100 });
    expect(search.dealCustomers).toEqual(["דנה בע״מ"]);
    expect(search.suitableNames).toEqual(["דנה"]);
    expect(search.leading).toBe(true);
  });

  it("ad groups and keywords nest under the campaign", () => {
    expect(search.adGroups[0]).toMatchObject({ id: "a1", leads: 2, spendIls: 100 });
    expect(search.keywords[0]).toMatchObject({ text: "תיק אל בד", matchType: "PHRASE", leads: 2, won: 1 });
  });

  it("a campaign that neither spent nor brought a lead is left out (paused PMax)", () => {
    expect(r.rows.find((x) => x.id === "242")).toBeUndefined();
  });

  it("leads without a campaign are counted apart, by reason", () => {
    expect(r.unattributed).toEqual({ total: 2, whatsapp: 1, notFound: 1, pending: 0 });
    expect(r.totals.leads).toBe(4);
  });

  it("the period filters spend", () => {
    const p = foldGooglePerformance([lead("l1")], [], snap, S, "2026-09-01");
    expect(p.rows.find((x) => x.id === "241")!.spendIls).toBe(100);
    expect(p.totals.spendIls).toBe(100);
  });

  it("no Google data → spend unknown (null), never ₪0, and the reason is kept", () => {
    const p = foldGooglePerformance([lead("l1")], [], { ok: false, reason: "פגה", configured: true, fetchedAt: "" }, S, null);
    const row = p.rows[0];
    expect(row.spendIls).toBeNull();
    expect(row.cplIls).toBeNull();
    expect(row.profitAfterAdsIls).toBeNull();
    expect(p.totals.spendIls).toBeNull();
    expect(p.spendUnavailable).toBe("פגה");
  });
});

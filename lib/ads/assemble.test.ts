import { describe, expect, it } from "vitest";
import { assembleRecommendations, conflictBetween } from "./assemble";
import { foldCrmEvidence, type CrmLeadRow } from "./crm-evidence";
import { APPROVED_DEFAULTS_2026_09_18 as S } from "./recommendation-settings";
import type { MetaAd, MetaSnapshot } from "./meta-evidence";
import type { ReviewState } from "./review-state";

const TODAY = "2026-09-18";

const lead = (sid: string, adId: string | null, name: string | null, suitable = false): CrmLeadRow => ({
  sid,
  metaAdId: adId,
  metaAdName: name,
  suitable,
});

const metaAd = (adId: string, adName: string, spend: number, leads: number, status = "PAUSED"): MetaAd => ({
  adId,
  adName,
  adSetId: `${adId}0`,
  adSetName: "set",
  campaignId: "9",
  campaignName: "camp",
  effectiveStatus: status,
  daily: [{ date: "2026-09-01", spendIls: spend, metaLeads: leads }],
});

const metaOk = (...ads: MetaAd[]): MetaSnapshot => ({
  ok: true,
  ads: new Map(ads.map((a) => [a.adId, a])),
  fetchedAt: "2026-09-18T06:30:00Z",
  rows: ads.length,
  pages: 1,
});

const review = (adId: string, approvedStatus: ReviewState["approvedStatus"], over: Partial<ReviewState> = {}): ReviewState => ({
  adId,
  adSetId: null,
  segment: "prospecting",
  role: "control",
  approvedStatus,
  decisionReason: "r",
  decidedBy: "widget",
  decidedAt: "2026-09-18T00:00:00Z",
  updatedAt: null,
  ...over,
});

describe("foldCrmEvidence", () => {
  it("groups by normalised Ad ID (ag: prefix), counts tagged leads, attaches deals by sid", () => {
    const crm = foldCrmEvidence(
      [
        lead("a", "ag:111", "C-magic", true),
        lead("b", "111", "C-magic"),
        lead("c", "ag:222", "C-magic"),
        lead("d", null, "07_chain_cut"),
      ],
      [
        { sid: "a", customerName: "דור", totalExVat: 8793 },
        { sid: "zzz", customerName: "not from an ad", totalExVat: 1 },
      ],
    );
    expect(crm.byAdId.get("111")).toMatchObject({ leads: 2, suitableLeads: 1, deals: 1, dealRevenueExVat: 8793, dealCustomers: ["דור"] });
    expect(crm.byAdId.get("222")).toMatchObject({ leads: 1, deals: 0 });
    expect(crm.unattributable).toEqual([{ sid: "d", adName: "07_chain_cut" }]);
    expect(crm.nameCollisions.get("C-magic")).toEqual(["111", "222"]);
  });
});

describe("assembleRecommendations", () => {
  it("one row per exact Ad ID; same-name copies are separate rows with a warning", () => {
    const crm = foldCrmEvidence([lead("a", "111", "C-magic"), lead("b", "222", "C-magic")], [{ sid: "a", customerName: "x", totalExVat: 5000 }]);
    const r = assembleRecommendations({
      settings: S,
      policyRevision: 3,
      today: TODAY,
      meta: metaOk(metaAd("111", "C-magic", 400, 30), metaAd("222", "C-magic", 20, 1)),
      crm,
      review: [],
    });
    expect(r.rows.map((x) => x.adId)).toEqual(["111", "222"]);
    expect(r.rows[0].recommendation.code).toBe("winner_candidate");
    expect(r.rows[1].recommendation.code).toBe("collecting");
    expect(r.rows[1].warnings.join()).toContain("111");
    expect(r.policyRevision).toBe(3);
  });

  it("Meta unavailable → every row 'cannot decide', reason visible, never a winner", () => {
    const crm = foldCrmEvidence([lead("a", "111", "x")], [{ sid: "a", customerName: "x", totalExVat: 5000 }]);
    const r = assembleRecommendations({
      settings: S,
      policyRevision: 0,
      today: TODAY,
      meta: { ok: false, configured: false, reason: "META_ADS_TOKEN לא מוגדר", fetchedAt: "t" },
      crm,
      review: [review("111", "winner")],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].recommendation.code).toBe("insufficient_or_conflicting_data");
    expect(r.rows[0].recommendation.reasons[0].text).toContain("META_ADS_TOKEN");
    expect(r.rows[0].conflict).toBeNull();
    expect(r.rows[0].approvedStatus).toBe("winner");
    expect(r.health.meta).toMatchObject({ ok: false, configured: false });
  });

  it("an Ad ID the CRM knows but Meta doesn't → cannot decide + listed in health", () => {
    const r = assembleRecommendations({
      settings: S,
      policyRevision: 0,
      today: TODAY,
      meta: metaOk(),
      crm: foldCrmEvidence([lead("a", "999", "ghost")], []),
      review: [],
    });
    expect(r.rows[0].recommendation.code).toBe("insufficient_or_conflicting_data");
    expect(r.health.unknownToMeta).toEqual(["999"]);
  });

  it("an ad that never spent is untested; the approved status is carried, never recomputed", () => {
    const r = assembleRecommendations({
      settings: S,
      policyRevision: 0,
      today: TODAY,
      meta: metaOk(metaAd("5", "fresh", 0, 0)),
      crm: foldCrmEvidence([], []),
      review: [review("5", "loser", { segment: "remarketing", role: "remarketing" })],
    });
    expect(r.rows[0]).toMatchObject({ approvedStatus: "loser", segment: "remarketing", role: "remarketing" });
    expect(r.rows[0].recommendation.code).toBe("untested");
  });

  it("flags a Meta/CRM lead-count mismatch as a warning only", () => {
    const r = assembleRecommendations({
      settings: S,
      policyRevision: 0,
      today: TODAY,
      meta: metaOk(metaAd("1", "a", 50, 4)),
      crm: foldCrmEvidence([lead("x", "1", "a")], []),
      review: [],
    });
    expect(r.rows[0].warnings).toContain("מטא סופרת 4 לידים, ב-CRM משויכים 1");
    expect(r.rows[0].recommendation.code).toBe("collecting");
  });

  it("structure usage counts only ACTIVE ads", () => {
    const r = assembleRecommendations({
      settings: S,
      policyRevision: 0,
      today: TODAY,
      meta: metaOk(metaAd("1", "a", 50, 4, "ACTIVE"), metaAd("2", "b", 50, 4, "CAMPAIGN_PAUSED")),
      crm: foldCrmEvidence([], []),
      review: [review("1", "testing"), review("2", "testing")],
    });
    expect(r.structure.usage).toMatchObject({ active: 1, control: { used: 1 } });
    expect(r.counts.collecting).toBe(2);
  });
});

describe("conflictBetween", () => {
  it.each([
    ["winner", "deal_economics_review", "CAC"],
    ["winner", "early_stop", "אינה מנצחת"],
    ["loser", "continue_to_deal_proof", "מתקדמת"],
    ["testing", "winner_candidate", "עדיין לא אושרה"],
    ["testing", "loser_candidate", "עדיין לא אושרה"],
    ["untested", "collecting", "לא נוסתה"],
  ] as const)("approved %s vs %s → conflict", (approved, code, word) => {
    expect(conflictBetween(approved, code)).toContain(word);
  });
  it.each([
    ["winner", "winner_candidate"],
    ["loser", "loser_candidate"],
    ["loser", "early_stop"],
    ["testing", "quality_review"],
    ["untested", "untested"],
    ["winner", "insufficient_or_conflicting_data"],
  ] as const)("approved %s vs %s → no conflict", (approved, code) => {
    expect(conflictBetween(approved, code)).toBeNull();
  });
});

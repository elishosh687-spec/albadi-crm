import { describe, expect, it } from "vitest";
import {
  daysBetween,
  recommend,
  type AdEvidence,
  type DailyRow,
  type RecommendationCode,
} from "./recommendation-engine";
import { APPROVED_DEFAULTS_2026_09_18, type AdRecommendationSettings } from "./recommendation-settings";
import { normalizeAdId } from "./ad-id";

const S = APPROVED_DEFAULTS_2026_09_18;
const TODAY = "2026-09-18";

function isoDay(offset: number, start = "2026-06-01"): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** One row per [spend, leads], on consecutive days from 2026-06-01. */
function days(...rows: [number, number][]): DailyRow[] {
  return rows.map(([spendIls, metaLeads], i) => ({ date: isoDay(i), spendIls, metaLeads }));
}

function ev(daily: DailyRow[], over: Partial<AdEvidence> = {}): AdEvidence {
  return {
    adId: "120252199877050562",
    daily,
    dailyHistoryComplete: true,
    crmLeads: 0,
    suitableLeads: 0,
    deals: 0,
    identityIssues: [],
    ...over,
  };
}

function with_(patch: (s: AdRecommendationSettings) => void): AdRecommendationSettings {
  const s = structuredClone(S);
  patch(s);
  return s;
}

const code = (e: AdEvidence, s = S, today = TODAY): RecommendationCode => recommend(e, s, today).code;

describe("no spend", () => {
  it("no rows → untested", () => expect(code(ev([]))).toBe("untested"));
  it("rows with ₪0 → untested", () => expect(code(ev(days([0, 0], [0, 0])))).toBe("untested"));
});

describe("first gate — ₪100", () => {
  it("₪99.99 is still collecting, and says how far is left", () => {
    const r = recommend(ev(days([99.99, 9])), S, TODAY);
    expect(r.code).toBe("collecting");
    expect(r.reasons.at(-1)!.text).toContain("₪0.01");
  });

  it.each([
    [8, "first_gate_pass"],
    [7, "quality_review"],
    [5, "quality_review"],
    [4, "early_stop"],
    [0, "early_stop"],
  ] as const)("exactly ₪100 with %i leads → %s", (leads, expected) => {
    expect(code(ev(days([100, leads])))).toBe(expected);
  });

  it("spend continued past the gate after a pass → stability_test", () => {
    expect(code(ev(days([100, 8], [50, 2])))).toBe("stability_test");
  });

  it("is judged on the leads AT ₪100, not on leads collected later", () => {
    // 4 leads when the gate was crossed, 10 by ₪180.
    const e = ev(days([60, 2], [40, 2], [80, 6]));
    const r = recommend(e, S, TODAY);
    expect(r.metrics.leadsAtFirstGate).toBe(4);
    expect(r.metrics.metaLeads).toBe(10);
    expect(r.code).toBe("early_stop");
  });

  it("the design's own example: ₪104, two leads → early stop with the numbers in Hebrew", () => {
    const r = recommend(ev(days([50, 1], [54, 1])), S, TODAY);
    expect(r.code).toBe("early_stop");
    expect(r.reasons[0].text).toBe("הוצאה ₪104, 2 לידים, CPL ₪52.");
  });

  it("review band stays a human decision even when many leads are tagged suitable", () => {
    expect(code(ev(days([100, 6]), { suitableLeads: 6 }))).toBe("quality_review");
  });

  it("a configured quality override lets the review band through", () => {
    const s = with_((x) => {
      x.suitableLead.allowQualityOverride = true;
      x.suitableLead.qualityOverrideMinSuitable = 3;
    });
    expect(code(ev(days([100, 6]), { suitableLeads: 3 }), s)).toBe("first_gate_pass");
    expect(code(ev(days([100, 6]), { suitableLeads: 2 }), s)).toBe("quality_review");
    expect(code(ev(days([100, 6]), { suitableLeads: null }), s)).toBe("quality_review");
  });
});

describe("stability gate — ₪250, CPL target ₪12.50 inclusive", () => {
  it("₪250 / 20 leads = ₪12.50 → continue", () => {
    expect(code(ev(days([100, 8], [150, 12])))).toBe("continue_to_deal_proof");
  });
  it("₪250 / 19 leads → stop", () => {
    expect(code(ev(days([100, 8], [150, 11])))).toBe("stop_after_stability");
  });
  it("one agora over the target → stop", () => {
    expect(code(ev(days([100, 8], [150.01, 12])))).toBe("stop_after_stability");
  });
  it("uses the leads at the crossing, not later ones", () => {
    const e = ev(days([100, 8], [150, 11], [100, 20]));
    expect(recommend(e, S, TODAY).metrics.leadsAtStability).toBe(19);
    expect(code(e)).toBe("stop_after_stability");
  });
});

describe("a CRM deal overrides CPL-only decisions", () => {
  it("₪104 with two leads but a deal → winner candidate (CAC ₪104)", () => {
    expect(code(ev(days([50, 1], [54, 1]), { deals: 1 }))).toBe("winner_candidate");
  });

  it.each([
    [500, "winner_candidate"],
    [499.99, "winner_candidate"],
    [500.01, "deal_economics_review"],
  ] as const)("CAC ₪%s → %s", (spend, expected) => {
    expect(code(ev(days([spend, 40]), { deals: 1 }))).toBe(expected);
  });

  it("fewer deals than the winner minimum continues rather than stopping", () => {
    const s = with_((x) => (x.verdict.winnerMinDeals = 2));
    expect(code(ev(days([100, 2]), { deals: 1 }), s)).toBe("continue_to_deal_proof");
  });

  it("with the override switched off, a CPL stop stands despite a deal", () => {
    const s = with_((x) => (x.economics.dealOverridesCplStop = false));
    expect(code(ev(days([104, 2]), { deals: 1 }), s)).toBe("early_stop");
    expect(code(ev(days([100, 8], [150, 12], [100, 10]), { deals: 1 }), s)).toBe("winner_candidate");
  });

  it("winner is always phrased as a recommendation", () => {
    const r = recommend(ev(days([400, 30]), { deals: 1 }), S, TODAY);
    expect(r.label).toBe("מועמדת למנצחת");
    expect(r.reasons.at(-1)!.text).toContain("המלצה בלבד");
  });
});

describe("deal-proof gate — ₪500 with no deal, 14 days from the LAST spend", () => {
  // 25 days of ₪20 → last spend 2026-06-25.
  const ran = ev(days(...Array.from({ length: 25 }, () => [20, 2] as [number, number])));
  it("day 13 after last spend → pause and mature", () => {
    expect(ran.daily.at(-1)!.date).toBe("2026-06-25");
    expect(code(ran, S, "2026-07-08")).toBe("pause_and_mature");
  });
  it("day 14 → loser candidate", () => {
    expect(code(ran, S, "2026-07-09")).toBe("loser_candidate");
  });
  it("maturation counts from the last day WITH spend, not the last row", () => {
    const trailing = ev([...ran.daily, { date: "2026-07-01", spendIls: 0, metaLeads: 3 }]);
    const r = recommend(trailing, S, "2026-07-09");
    expect(r.metrics.lastSpendDate).toBe("2026-06-25");
    expect(r.code).toBe("loser_candidate");
  });
  it("maturation can be switched off", () => {
    const s = with_((x) => (x.verdict.loserRequiresMaturation = false));
    expect(code(ran, s, "2026-06-25")).toBe("loser_candidate");
  });
});

describe("data problems never produce a verdict", () => {
  it("an identity issue blocks everything, even a deal", () => {
    const r = recommend(
      ev(days([400, 30]), { deals: 2, identityIssues: ["לליד אין Ad ID"] }),
      S,
      TODAY,
    );
    expect(r.code).toBe("insufficient_or_conflicting_data");
    expect(r.reasons[0].text).toBe("לליד אין Ad ID");
  });
  it("incomplete daily history → no winner, no loser", () => {
    expect(code(ev(days([400, 30]), { deals: 2, dailyHistoryComplete: false }))).toBe(
      "insufficient_or_conflicting_data",
    );
    expect(code(ev(days([600, 30]), { dailyHistoryComplete: false }), S, "2027-01-01")).toBe(
      "insufficient_or_conflicting_data",
    );
  });
  it("a negative or missing value in a Meta row → no verdict", () => {
    expect(code(ev(days([100, -1])))).toBe("insufficient_or_conflicting_data");
    expect(code(ev([{ date: "2026-06-01", spendIls: NaN, metaLeads: 3 }]))).toBe(
      "insufficient_or_conflicting_data",
    );
  });
});

describe("metrics", () => {
  it("counts delivery days only where spend > 0, and never rounds before deciding", () => {
    const r = recommend(ev(days([10.005, 1], [0, 0], [3.33, 0]), { deals: 0 }), S, TODAY);
    expect(r.metrics.deliveryDays).toBe(2);
    expect(r.metrics.firstSpendDate).toBe("2026-06-01");
    expect(r.metrics.lastSpendDate).toBe("2026-06-03");
  });
  it("CPL, CAC and contribution after ads", () => {
    const m = recommend(ev(days([799.28, 67]), { deals: 2 }), S, TODAY).metrics;
    expect(m.cplIls).toBeCloseTo(11.9296, 4);
    expect(m.cacIls).toBeCloseTo(399.64, 2);
    expect(m.contributionAfterAdsIls).toBeCloseTo(2200.72, 2);
  });
  it("daysBetween is calendar days, DST-proof", () => {
    expect(daysBetween("2026-09-01", "2026-09-15")).toBe(14);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("regression — the 18/09/2026 snapshot in meta-ads.md", () => {
  // Totals only (the per-day split is not in the document): one row on the
  // last spend date is enough for the deal and deal-proof rules.
  const snap = (spend: number, leads: number, deals: number, last: string) =>
    ev([{ date: last, spendIls: spend, metaLeads: leads }], { deals });

  it("07_chain_cut: ₪799.28, 2 deals, CAC ₪399.64 → winner candidate", () => {
    expect(code(snap(799.28, 67, 2, "2026-09-01"))).toBe("winner_candidate");
  });
  it("C-magic-hat-trick: ₪1,033.27, 2 deals, CAC ₪516.64 → deal economics review (above the ₪500 ceiling)", () => {
    expect(code(snap(1033.27, 92, 2, "2026-09-01"))).toBe("deal_economics_review");
  });
  it("concept-5-daylight-two-bags: ₪588, no deal, last spend 01/09 → maturing until 15/09, then loser", () => {
    expect(code(snap(588, 55, 0, "2026-09-01"), S, "2026-09-14")).toBe("pause_and_mature");
    expect(code(snap(588, 55, 0, "2026-09-01"), S, "2026-09-15")).toBe("loser_candidate");
  });
});

describe("normalizeAdId", () => {
  it("strips the sheet's ag: prefix so CRM and Meta IDs join", () => {
    expect(normalizeAdId("ag:120252199875770562")).toBe("120252199875770562");
    expect(normalizeAdId(" 120252199875770562 ")).toBe("120252199875770562");
    expect(normalizeAdId("AG:1")).toBe("1");
  });
  it("anything that is not an ID is null", () => {
    expect(normalizeAdId(null)).toBeNull();
    expect(normalizeAdId("")).toBeNull();
    expect(normalizeAdId("C-magic-hat-trick")).toBeNull();
  });
});

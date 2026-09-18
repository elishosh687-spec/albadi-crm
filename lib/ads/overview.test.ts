import { describe, expect, it } from "vitest";
import type { AdPerformanceRow } from "@/lib/analysis/ad-performance";
import type { AdRecommendationRow } from "./assemble";
import { buildRecommendationTodo, buildServerTodo, mergeOverviewRows, oneIn, sortOverviewRows } from "./overview";

const perf = (adName: string, adIds: string[], over: Partial<AdPerformanceRow> = {}): AdPerformanceRow => ({
  adName,
  adId: adIds[0] ?? null,
  adIds,
  campaignName: null,
  leads: 10,
  engaged: 0,
  markedGood: 0,
  won: 0,
  revenueIls: 0,
  dealCustomers: [],
  goodLeadNames: [],
  engagedPct: 0,
  spendIls: null,
  costPerLeadIls: null,
  costPerQualityLeadIls: null,
  roiIls: null,
  ...over,
} as AdPerformanceRow);

const rec = (adId: string, adName: string, spendIls: number, over: Partial<AdRecommendationRow> = {}): AdRecommendationRow =>
  ({
    adId,
    adName,
    adSetId: null,
    adSetName: null,
    campaignId: null,
    campaignName: null,
    effectiveStatus: null,
    segment: null,
    role: null,
    approvedStatus: "untested",
    approvedReason: null,
    approvedAt: null,
    crmLeads: 0,
    suitableLeads: null,
    deals: 0,
    dealRevenueExVat: 0,
    dealCustomers: [],
    recommendation: { code: "collecting", label: "אוספת נתונים", reasons: [], metrics: { spendIls } },
    evidence: { dailyHistoryComplete: true },
    warnings: [],
    conflict: null,
    ...over,
  }) as unknown as AdRecommendationRow;

describe("ads overview", () => {
  it("joins a recommendation by Ad ID (ag: prefix too), never by name", () => {
    const rows = mergeOverviewRows(
      [perf("07_chain_cut", ["ag:111"], { won: 3, revenueIls: 21279 })],
      [rec("111", "a renamed ad", 50), rec("222", "07_chain_cut", 80)],
    );
    const main = rows.find((r) => r.adName === "07_chain_cut" && r.key.startsWith("n:"))!;
    expect(main.rec?.adId).toBe("111");
    // the same-NAME ad with a different id is its own row, not merged
    expect(rows.find((r) => r.key === "id:222")?.rec?.adId).toBe("222");
  });

  it("shows the highest-spend copy when one name has several Ad IDs", () => {
    const [row] = mergeOverviewRows([perf("x", ["1", "2"])], [rec("1", "x", 10), rec("2", "x", 90)]);
    expect(row.rec?.adId).toBe("2");
    expect(row.recCount).toBe(2);
  });

  it("leaves out ads that never spent, brought no lead and carry no decision", () => {
    expect(mergeOverviewRows([], [rec("9", "idle", 0)])).toEqual([]);
    expect(mergeOverviewRows([], [rec("9", "spent", 40)])).toHaveLength(1);
  });

  it("keeps an ad with a deal, revenue or a good lead visible; folds the rest", () => {
    const rows = mergeOverviewRows([perf("a", ["1"], { markedGood: 1 }), perf("b", ["2"])], null);
    expect(rows.map((r) => r.leading)).toEqual([true, false]);
  });

  it("sorts by the chosen column, revenue as tie-break", () => {
    const rows = mergeOverviewRows(
      [perf("low", ["1"], { leads: 90, revenueIls: 100 }), perf("high", ["2"], { leads: 5, revenueIls: 900 })],
      null,
    );
    expect(sortOverviewRows(rows, "revenue").map((r) => r.adName)).toEqual(["high", "low"]);
    expect(sortOverviewRows(rows, "leads").map((r) => r.adName)).toEqual(["low", "high"]);
  });

  it("puts every failed connection and every unreported deal on the todo list", () => {
    const todo = buildServerTodo(
      { ok: false, problems: 1, checks: [{ key: "capi", label: "חיבור למטא (CAPI)", ok: false, detail: "אין תשובה" }, { key: "x", label: "ok", ok: true, detail: "" }] },
      {
        qualified: [],
        unreportedRevenueIls: 0,
        purchases: [
          { name: "Elran", state: "pending", valueIls: 3681 },
          { name: "סהר צור", state: "sent", valueIls: 5732 },
          { name: "פיצה", state: "not_from_meta", valueIls: 6800 },
        ],
      },
    );
    expect(todo.map((t) => t.key)).toEqual(["health-capi", "purchase-Elran"]);
    expect(todo[1].title).toContain("₪3,681");
  });

  it("flags missing Meta data and decisions that contradict the recommendation", () => {
    const todo = buildRecommendationTodo([rec("1", "a", 5, { conflict: "סותר" })], [], false, "no token");
    expect(todo.map((t) => t.key)).toEqual(["meta-down", "conflicts"]);
  });

  it("says how often a lead becomes X", () => {
    expect(oneIn(6, 270)).toBe("1 מכל 45");
    expect(oneIn(0, 270)).toBeNull();
  });
});

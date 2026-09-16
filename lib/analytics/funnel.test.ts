import { describe, expect, it } from "vitest";
import {
  aggregateLossReasons,
  buildBotFunnel,
  normalizeLossReason,
  percentage,
  summarizeProfits,
} from "./funnel";

describe("sales funnel analytics", () => {
  it("keeps attempts separate from unique leads and fills missing stages", () => {
    const result = buildBotFunnel([
      { event: "questionnaire_started", attempts: 12, uniqueLeads: 10 },
      { event: "quote_sent", attempts: 7, uniqueLeads: 6 },
    ]);

    expect(result[0]).toMatchObject({ attempts: 12, uniqueLeads: 10 });
    expect(result.find((row) => row.event === "quote_sent")).toMatchObject({
      attempts: 7,
      uniqueLeads: 6,
    });
    expect(result.find((row) => row.event === "call_booked")).toMatchObject({
      attempts: 0,
      uniqueLeads: 0,
    });
  });

  it("calculates stable one-decimal conversion rates", () => {
    expect(percentage(101, 326)).toBe(31);
    expect(percentage(0, 0)).toBeNull();
  });

  it("normalizes legacy loss reasons", () => {
    expect(normalizeLossReason("יקר_לו")).toBe("PRICE");
    expect(normalizeLossReason("לא_ענה")).toBe("NO_RESPONSE");
    expect(normalizeLossReason("opt_out")).toBe("OTHER");
    expect(normalizeLossReason(null)).toBe("UNRECORDED");
  });

  it("merges legacy and canonical loss-reason counts", () => {
    expect(
      aggregateLossReasons([
        { key: "PRICE", count: 3 },
        { key: "יקר_לו", count: 2 },
        { key: null, count: 4 },
      ])
    ).toEqual([
      { key: "PRICE", count: 5 },
      { key: "UNRECORDED", count: 4 },
    ]);
  });

  it("calculates average and median profit without inventing missing data", () => {
    expect(summarizeProfits([1000, 3000, 2000, Number.NaN])).toEqual({
      deals: 3,
      averageProfitIls: 2000,
      medianProfitIls: 2000,
    });
    expect(summarizeProfits([])).toEqual({
      deals: 0,
      averageProfitIls: null,
      medianProfitIls: null,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregateLossReasons,
  buildBotFunnel,
  funnelSteps,
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

  it("maps historical event names into the canonical funnel", () => {
    const result = buildBotFunnel([
      { event: "size_selected", attempts: 5, uniqueLeads: 4 },
      { event: "quote_replied", attempts: 3, uniqueLeads: 3 },
      { event: "call_completed", attempts: 2, uniqueLeads: 2 },
    ]);
    expect(result.find((row) => row.event === "size_answered")).toMatchObject({
      attempts: 5,
      uniqueLeads: 4,
    });
    expect(result.find((row) => row.event === "post_quote_reply")).toMatchObject({
      attempts: 3,
      uniqueLeads: 3,
    });
    expect(result.find((row) => row.event === "conversation_held")).toMatchObject({
      attempts: 2,
      uniqueLeads: 2,
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

describe("funnelSteps", () => {
  const row = (event: string, uniqueLeads: number, attempts = uniqueLeads) => ({ event, label: event, attempts, uniqueLeads });

  it("gives a drop % per step and marks only the biggest drop", () => {
    const s = funnelSteps([row("a", 326), row("b", 205), row("c", 174), row("d", 101)]);
    expect(s.map((x) => x.dropPct)).toEqual([null, 37, 15, 42]);
    expect(s.map((x) => x.worst)).toEqual([false, false, false, true]);
    expect(s[3].ofStart).toBe(31);
  });

  it("shows an unrecorded step as empty, not as a 100% drop", () => {
    const s = funnelSteps([row("a", 100), row("b", 0, 0)]);
    expect(s[1]).toMatchObject({ empty: true, dropPct: null, worst: false });
  });

  it("does not invent a drop when a later event count goes up", () => {
    const s = funnelSteps([row("a", 100), row("b", 150)]);
    expect(s[1].dropPct).toBeNull();
  });
});

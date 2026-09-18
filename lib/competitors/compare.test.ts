import { describe, expect, it } from "vitest";
import { gapVerdict, summarize } from "./compare";

describe("competitor comparison", () => {
  it("says who is cheaper on the order, in words and %", () => {
    expect(gapVerdict(12_500, 8_550)).toMatchObject({ tone: "good", amount: 3950, pct: 32, text: "אנחנו זולים ב־₪3,950 (32%)" });
    expect(gapVerdict(8_000, 8_550)).toMatchObject({ tone: "bad", amount: 550, pct: 7 });
    expect(gapVerdict(10_000, 10_040)?.tone).toBe("even");
  });

  it("gives no verdict without both totals", () => {
    expect(gapVerdict(null, 100)).toBeNull();
    expect(gapVerdict(100, null)).toBeNull();
  });

  it("summarizes only the rows that could be compared", () => {
    const s = summarize([gapVerdict(12_500, 8_550), gapVerdict(8_000, 8_550), null]);
    expect(s).toEqual({ compared: 2, cheaper: 1, dearer: 1, avgSaving: 1700 });
    expect(summarize([null]).avgSaving).toBeNull();
  });
});

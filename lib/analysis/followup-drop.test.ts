/**
 * lib/analysis/aggregate.ts — the DETERMINISTIC follow-up-drop rule that
 * replaced an LLM read (~92% "we dropped it" where the truth was ~13%).
 * A drop = the customer sent the last message and >3 days passed.
 */
import { describe, expect, it } from "vitest";
import { FOLLOWUP_DROP_DAYS, isFollowupDrop, toPatterns } from "./aggregate";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();

describe("isFollowupDrop", () => {
  it("customer wrote last, 4 days ago → drop", () => {
    expect(isFollowupDrop("in", daysAgo(4), NOW)).toBe(true);
  });
  it("customer wrote last, 2 days ago → not yet", () => {
    expect(isFollowupDrop("in", daysAgo(2), NOW)).toBe(false);
  });
  it("exactly the threshold is NOT a drop (strict >)", () => {
    expect(FOLLOWUP_DROP_DAYS).toBe(3);
    expect(isFollowupDrop("in", daysAgo(3), NOW)).toBe(false);
    expect(isFollowupDrop("in", new Date(NOW - 3 * 86400000 - 1).toISOString(), NOW)).toBe(true);
  });
  it("we wrote last → never a drop, however old", () => {
    expect(isFollowupDrop("out", daysAgo(30), NOW)).toBe(false);
  });
  it("accepts a Date and defaults `now` to the clock", () => {
    expect(isFollowupDrop("in", new Date(Date.now() - 10 * 86400000))).toBe(true);
  });
  it("missing / invalid timestamps are never a drop", () => {
    expect(isFollowupDrop("in", null, NOW)).toBe(false);
    expect(isFollowupDrop("in", undefined, NOW)).toBe(false);
    expect(isFollowupDrop("in", "not a date", NOW)).toBe(false);
    expect(isFollowupDrop(null, daysAgo(9), NOW)).toBe(false);
  });
});

describe("toPatterns", () => {
  it("sorts by count desc and labels each key", () => {
    const m = new Map([
      ["price", [{ sid: "a", name: null }]],
      ["moq", [{ sid: "b", name: "B" }, { sid: "c", name: null }]],
    ]);
    const p = toPatterns(m, (k) => `L:${k}`);
    expect(p.map((x) => x.key)).toEqual(["moq", "price"]);
    expect(p[0]).toMatchObject({ label: "L:moq", count: 2 });
    expect(p[0].leads).toHaveLength(2);
  });
});

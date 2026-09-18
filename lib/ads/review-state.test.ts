import { describe, expect, it } from "vitest";
import { validateReviewPatch } from "./review-state";
import { changedSettingKeys, APPROVED_DEFAULTS_2026_09_18 as D } from "./recommendation-settings";

describe("validateReviewPatch", () => {
  it("accepts a status change with a reason, on a normalised Ad ID", () => {
    const r = validateReviewPatch("ag:120252199877050562", { approvedStatus: "winner", reason: " 2 עסקאות " });
    expect(r).toEqual({ ok: true, adId: "120252199877050562", patch: { approvedStatus: "winner" }, reason: "2 עסקאות" });
  });
  it("a status change without a reason is refused", () => {
    expect(validateReviewPatch("1", { approvedStatus: "loser" })).toMatchObject({ ok: false, error: "שינוי סטטוס מאושר מחייב סיבה" });
    expect(validateReviewPatch("1", { approvedStatus: "loser", reason: "  " }).ok).toBe(false);
  });
  it("segment and role may change without a reason, and may be cleared", () => {
    expect(validateReviewPatch("1", { segment: "remarketing", role: null })).toMatchObject({ ok: true, patch: { segment: "remarketing", role: null } });
  });
  it("rejects a name instead of an ID, bad enums, unknown fields and an empty patch", () => {
    expect(validateReviewPatch("C-magic-hat-trick", { segment: "prospecting" }).ok).toBe(false);
    expect(validateReviewPatch("1", { approvedStatus: "champion", reason: "x" }).ok).toBe(false);
    expect(validateReviewPatch("1", { role: "lead" }).ok).toBe(false);
    expect(validateReviewPatch("1", { effectiveStatus: "PAUSED" }).ok).toBe(false);
    expect(validateReviewPatch("1", { reason: "x" }).ok).toBe(false);
    expect(validateReviewPatch("1", null).ok).toBe(false);
  });
});

describe("changedSettingKeys", () => {
  it("first save lists every key; later saves only what moved", () => {
    expect(changedSettingKeys(null, D).length).toBe(25);
    const next = structuredClone(D);
    next.gates.maturationDays = 21;
    next.suitableLead.tag = "ליד מתאים";
    expect(changedSettingKeys(D, next)).toEqual(["gates.maturationDays", "suitableLead.tag"]);
    expect(changedSettingKeys(D, structuredClone(D))).toEqual([]);
  });
});

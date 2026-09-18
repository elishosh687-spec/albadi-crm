import { describe, expect, it } from "vitest";
import {
  APPROVED_DEFAULTS_2026_09_18 as D,
  FIELD_LABELS,
  consistencyWarnings,
  normalizeStoredSettings,
  settingsToMarkdown,
  validateSettings,
  type AdRecommendationSettings,
} from "./recommendation-settings";

const clone = (): AdRecommendationSettings => structuredClone(D);
const errPaths = (raw: unknown) => {
  const r = validateSettings(raw);
  return r.ok ? [] : r.errors.map((e) => e.path);
};

describe("approved defaults (tests.md, 18/09/2026)", () => {
  it("are valid and carry the approved numbers", () => {
    const r = validateSettings(D);
    expect(r.ok).toBe(true);
    expect(D.economics).toMatchObject({ contributionProfitIls: 1500, maxCacIls: 500, targetCplIls: 12.5, expectedLeadsPerDeal: 40 });
    expect(D.gates).toMatchObject({
      firstGateSpendIls: 100, firstGatePassLeads: 8, firstGateReviewMin: 5, firstGateStopMax: 4,
      stabilitySpendIls: 250, dealProofSpendIls: 500, maturationDays: 14, referenceDailyBudgetIls: 20,
    });
    expect(D.structure).toMatchObject({ maxActiveAds: 4, controlSlots: 2, challengerSlots: 1, remarketingSlots: 1 });
  });

  it("suitable lead = the GHL tag Eli applies; no invented quality threshold", () => {
    expect(D.suitableLead).toEqual({ tag: "good lead", qualityOverrideMinSuitable: null, allowQualityOverride: false });
  });

  it("are internally consistent (1500/3 = 500, 500/40 = 12.5)", () => {
    expect(consistencyWarnings(D)).toEqual([]);
  });

  it("every field has a Hebrew label", () => {
    for (const [group, fields] of Object.entries(D)) {
      for (const key of Object.keys(fields)) expect(FIELD_LABELS[`${group}.${key}`]?.label).toBeTruthy();
    }
  });
});

describe("validateSettings rejects, never repairs", () => {
  it("spend gates must ascend", () => {
    const s = clone();
    s.gates.stabilitySpendIls = 100;
    expect(errPaths(s)).toContain("gates.stabilitySpendIls");
    const t = clone();
    t.gates.dealProofSpendIls = 250;
    expect(errPaths(t)).toContain("gates.dealProofSpendIls");
  });

  it("first-gate bands may not leave a gap", () => {
    const s = clone();
    s.gates.firstGateStopMax = 3; // 4 leads would have no decision
    expect(errPaths(s)).toContain("gates.firstGateReviewMin");
  });

  it("first-gate bands may not overlap", () => {
    const s = clone();
    s.gates.firstGateStopMax = 5; // 5 would be both stop and review
    expect(errPaths(s)).toContain("gates.firstGateReviewMin");
  });

  it("pass must sit above the review band", () => {
    const s = clone();
    s.gates.firstGatePassLeads = 5;
    expect(errPaths(s)).toContain("gates.firstGatePassLeads");
  });

  it("slots cannot exceed the active-ad cap", () => {
    const s = clone();
    s.structure.controlSlots = 3;
    expect(errPaths(s)).toContain("structure.maxActiveAds");
  });

  it("quality override needs a threshold", () => {
    const s = clone();
    s.suitableLead.allowQualityOverride = true;
    expect(errPaths(s)).toContain("suitableLead.qualityOverrideMinSuitable");
    s.suitableLead.qualityOverrideMinSuitable = 3;
    expect(validateSettings(s).ok).toBe(true);
  });

  it("blank tag is rejected; surrounding spaces are trimmed", () => {
    const s = clone();
    s.suitableLead.tag = "   ";
    expect(errPaths(s)).toContain("suitableLead.tag");
    s.suitableLead.tag = "  good lead ";
    const r = validateSettings(s);
    expect(r.ok && r.value.suitableLead.tag).toBe("good lead");
  });

  it("an unknown key is an error, not silently dropped", () => {
    const s: any = clone();
    s.gates.extraGateIls = 750;
    const r = validateSettings(s);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0].message).toContain("extraGateIls");
  });

  it("zero / negative money and fractional counts are rejected with Hebrew messages", () => {
    const s: any = clone();
    s.economics.targetCplIls = 0;
    s.gates.firstGatePassLeads = 7.5;
    const r = validateSettings(s);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path)).toEqual(
        expect.arrayContaining(["economics.targetCplIls", "gates.firstGatePassLeads"]),
      );
      for (const e of r.errors) expect(e.message).toMatch(/[א-ת]/);
    }
  });

  it("a missing field is reported, not defaulted", () => {
    const s: any = clone();
    delete s.economics.maxCacIls;
    expect(errPaths(s)).toContain("economics.maxCacIls");
  });
});

describe("consistencyWarnings", () => {
  it("warns but never changes the saved value", () => {
    const s = clone();
    s.economics.maxCacIls = 600;
    const w = consistencyWarnings(s);
    expect(w.length).toBe(2); // 1500/3 ≠ 600, and 600/40 ≠ 12.5
    expect(s.economics.maxCacIls).toBe(600);
  });
});

describe("normalizeStoredSettings", () => {
  it("fills keys a stored document predates from the defaults", () => {
    const stored: any = clone();
    delete stored.structure.evaluateRemarketingSeparately;
    const r = normalizeStoredSettings(stored);
    expect(r.ok && r.value.structure.evaluateRemarketingSeparately).toBe(true);
  });

  it("keeps stored values and still rejects an invalid stored document", () => {
    const stored = clone();
    stored.gates.maturationDays = 21;
    const r = normalizeStoredSettings(stored);
    expect(r.ok && r.value.gates.maturationDays).toBe(21);
    stored.gates.stabilitySpendIls = 50;
    expect(normalizeStoredSettings(stored).ok).toBe(false);
  });

  it("an empty row yields the approved defaults", () => {
    const r = normalizeStoredSettings(null);
    expect(r.ok && r.value).toEqual(D);
  });
});

describe("settingsToMarkdown", () => {
  it("states the revision, that the widget holds the live values, and the key numbers", () => {
    const md = settingsToMarkdown(D, 3);
    expect(md).toContain("גרסה 3");
    expect(md).toContain("הגדרות בדיקה");
    expect(md).toContain("₪12.5");
    expect(md).toContain("בדיקת איכות 5–7");
    expect(md).toContain("`good lead`");
    expect(md).toContain("עקיפת איכות: כבויה");
  });
});

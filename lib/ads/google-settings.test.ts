/**
 * lib/ads/google-settings.ts — the Google world's own settings (2026-09-23).
 */
import { describe, expect, it } from "vitest";
import {
  GOOGLE_DEFAULTS_2026_09_23 as D,
  GOOGLE_FIELD_LABELS,
  GOOGLE_SETTING_HELP,
  changedGoogleKeys,
  googleConsistencyWarnings,
  googleSettingsToMarkdown,
  validateGoogleSettings,
} from "./google-settings";

const clone = () => structuredClone(D);

describe("validateGoogleSettings", () => {
  it("the defaults are valid, with CPL deliberately empty", () => {
    const v = validateGoogleSettings(D);
    expect(v.ok).toBe(true);
    expect(D.economics.targetCplIls).toBeNull();
  });

  it("an unknown key is an error, never silently dropped", () => {
    const v = validateGoogleSettings({ ...clone(), extra: {} });
    expect(v.ok).toBe(false);
  });

  it("rejects a non-numeric conversion action id and an empty tag", () => {
    const s = clone();
    s.measurement.formConversionActionId = "abc";
    s.suitableLead.tag = " ";
    const v = validateGoogleSettings(s);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.map((e) => e.path).sort()).toEqual(["measurement.formConversionActionId", "suitableLead.tag"]);
  });

  it("attribution window cannot pass Google's 90-day click history", () => {
    const s = clone();
    s.alerts.attributionLookbackDays = 120;
    expect(validateGoogleSettings(s).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("every field has a label and help text", () => {
    for (const [g, fields] of Object.entries(D)) {
      for (const k of Object.keys(fields)) {
        expect(GOOGLE_FIELD_LABELS[`${g}.${k}`], `${g}.${k}`).toBeDefined();
        expect(GOOGLE_SETTING_HELP[`${g}.${k}`], `${g}.${k}`).toBeDefined();
      }
    }
  });

  it("warns (does not block) when CAC exceeds profit", () => {
    const s = clone();
    s.economics.maxCacIls = 2000;
    expect(googleConsistencyWarnings(s)).toHaveLength(1);
    expect(validateGoogleSettings(s).ok).toBe(true);
  });

  it("lists changed keys", () => {
    const s = clone();
    s.alerts.clicksWithoutLeadsMin = 50;
    expect(changedGoogleKeys(D, s)).toEqual(["alerts.clicksWithoutLeadsMin"]);
  });

  it("markdown names the empty CPL", () => {
    expect(googleSettingsToMarkdown(D, 0)).toContain("CPL יעד בגוגל: לא מוגדר");
  });
});

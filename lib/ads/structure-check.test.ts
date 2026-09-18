import { describe, expect, it } from "vitest";
import { checkStructure, type StructureInput } from "./structure-check";
import { APPROVED_DEFAULTS_2026_09_18 as S } from "./recommendation-settings";

const ad = (id: string, over: Partial<StructureInput> = {}): StructureInput => ({
  adId: id,
  adName: `ad-${id}`,
  segment: "prospecting",
  role: "control",
  effectiveStatus: "ACTIVE",
  ...over,
});

describe("checkStructure", () => {
  it("the approved round (2 controls, 1 challenger, 1 remarketing) is clean", () => {
    const r = checkStructure(
      [
        ad("1"),
        ad("2"),
        ad("3", { role: "challenger" }),
        ad("4", { role: "remarketing", segment: "remarketing" }),
        ad("5", { effectiveStatus: "PAUSED" }),
      ],
      S,
    );
    expect(r.warnings).toEqual([]);
    expect(r.usage).toMatchObject({ active: 4, max: 4, control: { used: 2, max: 2 } });
  });

  it("only ACTIVE counts — CAMPAIGN_PAUSED does not deliver", () => {
    const r = checkStructure([ad("1", { effectiveStatus: "CAMPAIGN_PAUSED" })], S);
    expect(r.usage.active).toBe(0);
  });

  it("warns on a fifth ad and a third control", () => {
    const r = checkStructure([ad("1"), ad("2"), ad("3"), ad("4", { role: "challenger" }), ad("5", { role: "remarketing", segment: "remarketing" })], S);
    expect(r.warnings.join("\n")).toContain("5 מודעות פעילות");
    expect(r.warnings.join("\n")).toContain("3 מודעות Control");
  });

  it("an active ad without a segment or role is flagged, never guessed", () => {
    const r = checkStructure([ad("1", { segment: null }), ad("2", { role: null })], S);
    expect(r.usage.unassigned).toBe(2);
    expect(r.warnings).toHaveLength(2);
  });

  it("flags remarketing and prospecting mixed across role and segment", () => {
    const r = checkStructure([ad("1", { segment: "remarketing", role: "control" })], S);
    expect(r.warnings[0]).toContain("רימרקטינג בתפקיד של פרוספקטינג");
  });
});

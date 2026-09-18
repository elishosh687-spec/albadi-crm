import { describe, expect, it } from "vitest";
import { groupByLabel, sourceLabel, stageLabel } from "./labels";

describe("analytics display labels", () => {
  it("names raw lead sources in Hebrew and keeps unknown keys visible", () => {
    expect(sourceLabel("greenapi_webhook")).toBe("וואטסאפ ישיר");
    expect(sourceLabel("fb_form")).toBe("טופס פייסבוק");
    expect(sourceLabel("brand_new_source")).toBe("brand_new_source");
    expect(sourceLabel(null)).toBe("לא ידוע");
  });

  it("uses Eli's stage words for current, side and legacy stages", () => {
    expect(stageLabel("DISCAVERY")).toBe("אפיון");
    expect(stageLabel("FUTURE_FOLLOW_UP")).toBe("להתקשר בעתיד");
    expect(stageLabel("NEGOTIATING")).toBe("שוקל / משא ומתן");
    expect(stageLabel("UNCLASSIFIED")).toBe("בלי שלב (בשאלון)");
  });

  it("merges a legacy stage into its current stage", () => {
    const rows = [
      { stage: "CONSIDERATION", count: 3 },
      { stage: "NEGOTIATING", count: 2 },
      { stage: "LOST", count: 9 },
    ];
    expect(groupByLabel(rows, (r) => stageLabel(r.stage))).toEqual([
      { label: "אבוד", count: 9 },
      { label: "שוקל / משא ומתן", count: 5 },
    ]);
  });
});

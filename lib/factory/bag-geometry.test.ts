import { describe, it, expect } from "vitest";
import { validateBagGeometry, maxHeightForDepth } from "./bag-geometry";

describe("bag geometry — the ½·D+35 height ceiling", () => {
  // The two sizes Eli brought on 2026-09-22 ("למה הוא לא מחשב?"): both are
  // tall bags whose height exceeds ½·gusset+35, so the calculator blocks them
  // before it ever calls the estimator. Pending Simon's answer on the real
  // machine limit — if it changes, this test changes with the constant.
  it("blocks H50/W30/D14 and H55/W36/D15 on the height-vs-gusset rule", () => {
    expect(maxHeightForDepth(14)).toBe(42);
    expect(maxHeightForDepth(15)).toBe(42.5);
    expect(validateBagGeometry(30, 14, 50).join(" ")).toContain("גובה מקסימלי");
    expect(validateBagGeometry(36, 15, 55).join(" ")).toContain("גובה מקסימלי");
  });

  it("the same sizes pass once the gusset carries the height", () => {
    expect(validateBagGeometry(40, 30, 50)).toEqual([]);
    expect(validateBagGeometry(45, 39, 54)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { MOLD_CNY_PER_COLOR, moldsCostCnyFor } from "./molds";

describe("molds — ¥1,000 per colour, one definition (2026-09-06)", () => {
  it("the house number is ¥1,000 per colour", () => {
    expect(MOLD_CNY_PER_COLOR).toBe(1000);
  });

  it.each([
    [0, 1000],
    [NaN, 1000],
    [-5, 1000],
    [1, 1000],
    [2, 2000],
    [2.4, 2000],
    [2.6, 3000],
    [6, 6000],
  ])("moldsCostCnyFor(%s) → ¥%d", (colors, want) => {
    expect(moldsCostCnyFor(colors)).toBe(want);
  });

  it("accepts a numeric string (the form sends one)", () => {
    expect(moldsCostCnyFor("3" as unknown as number)).toBe(3000);
    expect(moldsCostCnyFor("" as unknown as number)).toBe(1000);
    expect(moldsCostCnyFor(undefined as unknown as number)).toBe(1000);
  });
});

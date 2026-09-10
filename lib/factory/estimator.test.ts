import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CARTON_COEF, DEFAULT_ESTIMATOR_COEFFS } from "./estimator-defaults";

// The estimator asks the factory config for the shipping buffer — a DB read.
// Stand in for it so each test controls the buffer (or the failure) explicitly.
const cfgState = vi.hoisted(() => ({ cfg: null as Record<string, number> | null, reject: false, calls: 0 }));
vi.mock("@/lib/factory/config", () => ({
  getFactoryConfig: () => {
    cfgState.calls++;
    return cfgState.reject ? Promise.reject(new Error("no db in a unit test")) : Promise.resolve(cfgState.cfg);
  },
}));
vi.mock("./config", () => ({
  getFactoryConfig: () => {
    cfgState.calls++;
    return cfgState.reject ? Promise.reject(new Error("no db in a unit test")) : Promise.resolve(cfgState.cfg);
  },
}));

import {
  allowedFactoriesFor,
  bagAreaCm2,
  estimateFactoryCny,
  isNarrowTall,
  type EstimateSpec,
} from "./estimator";

const COEFFS = DEFAULT_ESTIMATOR_COEFFS;
const MANDY = COEFFS.factories.Mandy;

/** 35×40×10 · 5,000 · handles · no lamination · 2 colours — the happy path. */
function spec(overrides: Partial<EstimateSpec> = {}): EstimateSpec {
  return {
    widthCm: 35,
    heightCm: 40,
    depthCm: 10,
    quantity: 5000,
    hasHandles: true,
    hasLamination: false,
    logoColors: 2,
    ...overrides,
  };
}
const AREA = bagAreaCm2(40, 10, 35); // 3950

beforeEach(() => {
  cfgState.cfg = null;
  cfgState.reject = true;
  cfgState.calls = 0;
});

describe("allowedFactoriesFor (Simon's table, 2026-09-10)", () => {
  it("heat-press 3D → Mandy; heat-press 2D → 亚森; sewing → 亚森; never CHEN", () => {
    expect(allowedFactoriesFor({ depthCm: 10 })).toEqual(["Mandy"]);
    expect(allowedFactoriesFor({ depthCm: 10, construction: "heat_press" })).toEqual(["Mandy"]);
    expect(allowedFactoriesFor({ depthCm: 2 })).toEqual(["亚森"]);
    expect(allowedFactoriesFor({ depthCm: 0 })).toEqual(["亚森"]);
    expect(allowedFactoriesFor({ depthCm: 10, construction: "sewing" })).toEqual(["亚森"]);
    expect(allowedFactoriesFor({ depthCm: 0, construction: "sewing" })).toEqual(["亚森"]);
    for (const c of [undefined, "heat_press", "sewing"] as const) {
      for (const d of [0, 2, 3, 15]) expect(allowedFactoriesFor({ depthCm: d, construction: c })).not.toContain("CHEN");
    }
  });
});

describe("geometry helpers", () => {
  it("bagAreaCm2 = 2HW + 2HD + WD", () => {
    expect(bagAreaCm2(40, 10, 35)).toBe(3950);
    expect(bagAreaCm2(30, 10, 30)).toBe(2700);
    expect(bagAreaCm2(30, 0, 40)).toBe(2400);
  });

  it("isNarrowTall: depth ≤ 10 and height ≥ 1.5 × width", () => {
    expect(isNarrowTall({ heightCm: 50, depthCm: 9, widthCm: 33 })).toBe(true);
    expect(isNarrowTall({ heightCm: 40, depthCm: 10, widthCm: 35 })).toBe(false);
    expect(isNarrowTall({ heightCm: 45, depthCm: 10, widthCm: 30 })).toBe(true); // exactly 1.5×
    expect(isNarrowTall({ heightCm: 60, depthCm: 11, widthCm: 30 })).toBe(false); // too deep
    expect(isNarrowTall({ heightCm: 60, depthCm: 0, widthCm: 30 })).toBe(false); // flat is not gusseted
  });
});

describe("estimateFactoryCny — happy path", () => {
  it("35×40×10 · 5,000 · handles · 2 colours → Mandy, a finite unit price", async () => {
    const r = await estimateFactoryCny(spec(), COEFFS);
    expect(r.ok).toBe(true);
    expect(r.refused).toBeUndefined();
    expect(r.factoryName).toBe("Mandy");
    expect(r.tier).toBe(5000);
    expect(r.areaCm2).toBe(AREA);
    expect(Number.isFinite(r.factoryUnitCostCny)).toBe(true);
    expect(r.factoryUnitCostCny!).toBeGreaterThan(0);
    const t = MANDY.tiers["5000"];
    const want = t.base!.makeFee + t.base!.perCm2 * AREA + t.color["2"] + t.handle;
    expect(r.factoryUnitCostCny).toBeCloseTo(want, 2);
    expect(r.breakdown).toEqual({
      baseCny: Math.round((t.base!.makeFee + t.base!.perCm2 * AREA) * 1000) / 1000,
      colorCny: 0.05,
      handleCny: 0.02,
      lamCny: 0,
    });
    expect(r.confidence).toBe("high");
    expect(r.plateFeeOneTimeCny).toBe(0);
    expect(r.platePerColorCny).toBe(0);
    expect(r.candidates).toEqual([{ factory: "Mandy", unitCny: r.factoryUnitCostCny, inRange: true }]);
  });

  it("handles and colours are separable add-ons", async () => {
    const base = await estimateFactoryCny(spec({ hasHandles: false, logoColors: 1 }), COEFFS);
    const withHandles = await estimateFactoryCny(spec({ hasHandles: true, logoColors: 1 }), COEFFS);
    const threeColours = await estimateFactoryCny(spec({ hasHandles: false, logoColors: 3 }), COEFFS);
    expect(withHandles.factoryUnitCostCny! - base.factoryUnitCostCny!).toBeCloseTo(0.02, 2);
    expect(threeColours.factoryUnitCostCny! - base.factoryUnitCostCny!).toBeCloseTo(0.15, 2);
    expect(base.breakdown!.colorCny).toBe(0);
  });

  // Eli 2026-09-10: past the table each extra colour adds the last step.
  it("a 4th / 5th colour keeps adding the last step instead of clamping at 3", async () => {
    const c3 = (await estimateFactoryCny(spec({ logoColors: 3 }), COEFFS)).breakdown!.colorCny;
    const c4 = (await estimateFactoryCny(spec({ logoColors: 4 }), COEFFS)).breakdown!.colorCny;
    const c5 = (await estimateFactoryCny(spec({ logoColors: 5 }), COEFFS)).breakdown!.colorCny;
    expect(c3).toBe(0.15);
    expect(c4).toBeCloseTo(0.25, 3);
    expect(c5).toBeCloseTo(0.35, 3);
  });

  it("lamination on a heat-press 3D bag prices the plate fee per colour", async () => {
    const r = await estimateFactoryCny(spec({ hasLamination: true, logoColors: 2 }), COEFFS);
    expect(r.ok).toBe(true);
    expect(r.factoryName).toBe("Mandy");
    const t = MANDY.tiers["5000"];
    expect(r.breakdown!.baseCny).toBeCloseTo(t.lam!.makeFee + t.lam!.perCm2 * AREA, 3);
    expect(r.breakdown!.handleCny).toBe(t.lamHandle);
    const platePer = MANDY.plateFeePerColor!.perCm2 * AREA;
    expect(r.platePerColorCny).toBeCloseTo(platePer, 2);
    expect(r.plateFeeOneTimeCny).toBeCloseTo(platePer * 2, 1);
    expect(r.reasoning!.some((l) => l.includes("版费 למינציה"))).toBe(true);
  });

  it("carries a reasoning trail naming Simon's table and the chosen factory", async () => {
    const r = await estimateFactoryCny(spec(), COEFFS);
    const text = r.reasoning!.join("\n");
    expect(text).toContain("שטח השקית = 2·H·W + 2·H·D + W·D");
    expect(text).toContain("סוג ייצור: חום (heat-press) תלת-ממד → לפי הטבלה של סיימון מתאים: Mandy + CHEN (ללא טבלת מחירים)");
    expect(text).toContain("מפעל נבחר: Mandy (כמות 5000)");
    expect(text).toContain("+ 2 צבעים");
    expect(text).toContain("+ ידיות");
    expect(text).toContain("כולל כרית ביטחון שילוח +15%");
  });
});

describe("estimateFactoryCny — carton + shipping buffer", () => {
  const tMm = DEFAULT_CARTON_COEF.perFactoryTMm!.Mandy;

  it("falls back to the default 15% buffer when the config cannot be read", async () => {
    cfgState.reject = true;
    const r = await estimateFactoryCny(spec(), COEFFS);
    expect(cfgState.calls).toBe(1);
    expect(r.carton!.cbmPerUnit).toBeCloseTo(tMm * AREA * 1e-7 * 1.15, 9);
    expect(r.carton!.confidence).toBe("high");
    expect(r.carton!.weightApprox).toBe(true);
    expect(r.carton!.qty % DEFAULT_CARTON_COEF.bundleSnap).toBe(0);
    // carton dims encode cbmPerUnit × qty exactly
    const cartonCbm = (r.carton!.lengthCm * r.carton!.widthCm * r.carton!.heightCm) / 1e6;
    expect(cartonCbm).toBeCloseTo(r.carton!.cbmPerUnit * r.carton!.qty, 3);
  });

  it("laminated bags default to the 10% buffer", async () => {
    cfgState.cfg = null;
    cfgState.reject = false;
    const r = await estimateFactoryCny(spec({ hasLamination: true }), COEFFS);
    expect(r.carton!.cbmPerUnit).toBeCloseTo(tMm * AREA * 1e-7 * 1.1, 9);
  });

  it("reads the buffers from the factory config when present", async () => {
    cfgState.reject = false;
    cfgState.cfg = { estimatorShippingBufferPct: 30, estimatorShippingBufferLamPct: 0 };
    const plain = await estimateFactoryCny(spec(), COEFFS);
    expect(plain.carton!.cbmPerUnit).toBeCloseTo(tMm * AREA * 1e-7 * 1.3, 9);
    expect(plain.reasoning!.join("\n")).toContain("+30%");
    const lam = await estimateFactoryCny(spec({ hasLamination: true }), COEFFS);
    expect(lam.carton!.cbmPerUnit).toBeCloseTo(tMm * AREA * 1e-7, 9);
  });

  it("a negative configured buffer is clamped to 0", async () => {
    cfgState.reject = false;
    cfgState.cfg = { estimatorShippingBufferPct: -20 };
    const r = await estimateFactoryCny(spec(), COEFFS);
    // measure mode skips the construction gate, so the cheapest factory wins —
    // and the packing thickness is per factory (亚森 packs ~10% denser than Mandy).
    const tFactory = COEFFS.carton?.perFactoryTMm?.[r.factoryName!] ?? tMm;
    expect(r.carton!.cbmPerUnit).toBeCloseTo(tFactory * AREA * 1e-7, 9);
  });

  it("measure mode: raw model, no buffer, no config read, no MIN_QTY / flat refusals", async () => {
    const r = await estimateFactoryCny(spec({ quantity: 1000 }), COEFFS, { measure: true });
    expect(cfgState.calls).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(3000);
    // measure mode skips the construction gate, so the cheapest factory wins —
    // and the packing thickness is per factory (亚森 packs ~10% denser than Mandy).
    const tFactory = COEFFS.carton?.perFactoryTMm?.[r.factoryName!] ?? tMm;
    expect(r.carton!.cbmPerUnit).toBeCloseTo(tFactory * AREA * 1e-7, 9);
    const flat = await estimateFactoryCny(spec({ depthCm: 2, widthCm: 40, heightCm: 40 }), COEFFS, { measure: true });
    expect(flat.ok).toBe(true);
    expect(flat.carton!.confidence).toBe("low");
  });
});

describe("estimateFactoryCny — the refusal ladder", () => {
  it("absurd quantity (> 200,000)", async () => {
    const r = await estimateFactoryCny(spec({ quantity: 250_000 }), COEFFS);
    expect(r.ok).toBe(false);
    expect(r.refused).toContain("חריגה");
    expect(r.refused).toContain("שלח למפעל");
  });

  // 2026-09-10: below 3,000 the catalog has no data and factories quote 1.5–2×.
  it("below the 3,000 minimum", async () => {
    const r = await estimateFactoryCny(spec({ quantity: 1000 }), COEFFS);
    expect(r.ok).toBe(false);
    expect(r.refused).toContain("מתחת למינימום");
    expect(r.refused).toMatch(/3[,.  ]?000/);
    expect((await estimateFactoryCny(spec({ quantity: 3000 }), COEFFS)).ok).toBe(true);
    expect((await estimateFactoryCny(spec({ quantity: 2999 }), COEFFS)).ok).toBe(false);
  });

  // 2026-09-10: wine-style bags came in 40–50% above the area model.
  it("narrow-and-tall (wine / bottle) geometry", async () => {
    const r = await estimateFactoryCny(spec({ widthCm: 33, heightCm: 50, depthCm: 9 }), COEFFS);
    expect(r.ok).toBe(false);
    expect(r.refused).toContain("שקית צרה וגבוהה");
  });

  it("sewing without lamination — the catalog only prices sewn laminated bags", async () => {
    const r = await estimateFactoryCny(spec({ construction: "sewing" }), COEFFS);
    expect(r.ok).toBe(false);
    expect(r.refused).toContain("שקית תפורה בלי למינציה");
  });

  it("sewing with lamination — no sewing coefficients in the default fit", async () => {
    const r = await estimateFactoryCny(spec({ construction: "sewing", hasLamination: true }), COEFFS);
    expect(r.ok).toBe(false);
    expect(r.refused).toContain("תפירה עם למינציה");
    expect(r.candidates).toEqual([]);
  });

  it("heat-press 2D with lamination — 亚森 does not laminate by heat-press", async () => {
    const r = await estimateFactoryCny(spec({ depthCm: 2, hasLamination: true }), COEFFS);
    expect(r.ok).toBe(false);
    expect(r.refused).toContain("אף מפעל מוכר לא מייצר למינציה");
  });

  it("area outside the factory's data envelope", async () => {
    const tiny = await estimateFactoryCny(spec({ widthCm: 10, heightCm: 10, depthCm: 5 }), COEFFS);
    expect(tiny.ok).toBe(false);
    expect(tiny.refused).toContain("מחוץ לטווח הנתונים של Mandy");
    expect(tiny.candidates![0].inRange).toBe(false);
    const huge = await estimateFactoryCny(spec({ widthCm: 70, heightCm: 70, depthCm: 20 }), COEFFS);
    expect(huge.ok).toBe(false);
    expect(huge.refused).toContain("מחוץ לטווח");
  });

  it("flat / tray geometry — the CBM cannot be estimated reliably", async () => {
    const flat = await estimateFactoryCny(spec({ depthCm: 2, widthCm: 40, heightCm: 40 }), COEFFS);
    expect(flat.ok).toBe(false);
    expect(flat.refused).toContain("צורה שטוחה/חריגה");
    expect(flat.candidates![0].factory).toBe("亚森");
    const tray = await estimateFactoryCny(spec({ widthCm: 60, heightCm: 9, depthCm: 15 }), COEFFS);
    expect(tray.ok).toBe(false);
    expect(tray.refused).toContain("צורה שטוחה/חריגה");
  });

  it("the quantity checks come before the geometry checks", async () => {
    const r = await estimateFactoryCny(spec({ quantity: 1000, widthCm: 33, heightCm: 50, depthCm: 9 }), COEFFS);
    expect(r.refused).toContain("מתחת למינימום");
  });
});

describe("estimateFactoryCny — anchoring above the trained ceiling", () => {
  it("quantity > maxQty prices at the 10,000 tier with medium confidence", async () => {
    const r = await estimateFactoryCny(spec({ quantity: 20_000 }), COEFFS);
    expect(COEFFS.maxQty).toBe(10000);
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(10000);
    expect(r.confidence).toBe("medium");
    expect(r.reasoning!.join("\n")).toContain("⚠️ אומדן מבוסס על 10,000 יח׳");
    const atCeiling = await estimateFactoryCny(spec({ quantity: 10_000 }), COEFFS);
    expect(atCeiling.confidence).toBe("high");
    expect(atCeiling.factoryUnitCostCny).toBe(r.factoryUnitCostCny);
  });

  it("tiers snap down: 4,999 → 3,000, 9,999 → 5,000", async () => {
    expect((await estimateFactoryCny(spec({ quantity: 4999 }), COEFFS)).tier).toBe(3000);
    expect((await estimateFactoryCny(spec({ quantity: 9999 }), COEFFS)).tier).toBe(5000);
    expect((await estimateFactoryCny(spec({ quantity: 200_000 }), COEFFS)).ok).toBe(true);
  });
});

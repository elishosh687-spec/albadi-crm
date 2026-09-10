import { describe, expect, it } from "vitest";
import { calculateQuote } from "./engine";
import { colorAddonFromTable, colorTableFromRecord } from "./color-addon";
import { resolveLamination, suggestsLamination, LAMINATION_DEFAULT_FROM_COLORS } from "./lamination";
import { ceilAgorot } from "@/lib/factory/rounding";
import type { AppConfig, QuoteFormData } from "./types";
import {
  AIR_QTY,
  AIR_RATES,
  AIR_USD_TO_ILS,
  BULKY_CARTON,
  DENSE_CARTON,
  airTestAppConfig,
  appConfig,
  flatSeaAppConfig,
} from "@/tests/fixtures/factory-config";

const KG_PER_CBM = 167;

function form(overrides: Partial<QuoteFormData> = {}): QuoteFormData {
  return {
    productId: "p2",
    quantityTierId: "q2",
    quantityOverride: null,
    hasHandles: true,
    logoColors: 1,
    shippingOptionId: "s2",
    selectedFeatureIds: [],
    ...overrides,
  };
}

const CFG = appConfig();
const p2 = CFG.products.find((p) => p.id === "p2")!;

describe("calculateQuote — inputs", () => {
  it("returns null for an unknown product", () => {
    expect(calculateQuote(form({ productId: "nope" }), CFG)).toBeNull();
    expect(calculateQuote(form({ productId: null }), CFG)).toBeNull();
  });

  it("returns null when neither a tier nor an override gives a quantity", () => {
    expect(calculateQuote(form({ quantityTierId: null, quantityOverride: null }), CFG)).toBeNull();
    expect(calculateQuote(form({ quantityTierId: "q99" }), CFG)).toBeNull();
  });

  it("quantityOverride wins over the tier", () => {
    expect(calculateQuote(form({ quantityOverride: 7000 }), CFG)?.quantity).toBe(7000);
    expect(calculateQuote(form(), CFG)?.quantity).toBe(5000);
  });

  it("findClosestPrice snaps DOWN to the lower tier (4,999 → the 3,000 price)", () => {
    const r = calculateQuote(form({ quantityOverride: 4999 }), CFG)!;
    expect(r.basePriceCny).toBe(p2.withHandles.prices["3000"]);
    expect(calculateQuote(form({ quantityOverride: 5000 }), CFG)!.basePriceCny).toBe(p2.withHandles.prices["5000"]);
    expect(calculateQuote(form({ quantityOverride: 500 }), CFG)!.basePriceCny).toBe(p2.withHandles.prices["1000"]);
  });

  it("the margin matrix snaps down the same way", () => {
    const cfg = appConfig({
      adminSettings: { globalProfitMargin: 40, profitMarginByQuantity: { "3000": 30, "5000": 45 } },
    });
    expect(calculateQuote(form({ quantityOverride: 4999 }), cfg)!.profitMargin).toBe(30);
    expect(calculateQuote(form({ quantityOverride: 5000 }), cfg)!.profitMargin).toBe(45);
    const noMatrix = appConfig({ adminSettings: { globalProfitMargin: 33 } });
    expect(calculateQuote(form(), noMatrix)!.profitMargin).toBe(33);
  });

  it("handles pick the variant", () => {
    const withH = calculateQuote(form({ hasHandles: true }), CFG)!;
    const without = calculateQuote(form({ hasHandles: false }), CFG)!;
    expect(withH.basePriceCny).toBe(p2.withHandles.prices["5000"]);
    expect(without.basePriceCny).toBe(p2.withoutHandles.prices["5000"]);
    expect(withH.handlesAddonCny).toBeCloseTo(0.65 - 0.63, 2);
    expect(without.handlesAddonCny).toBe(0);
  });
});

describe("calculateQuote — customer price rules", () => {
  it("per-bag price is rounded UP to the agora and the total derives from it", () => {
    const r = calculateQuote(form(), CFG)!;
    expect(r.sellingPricePerUnitIls).toBe(ceilAgorot(r.sellingPricePerUnitIls));
    expect(r.totalOrderPriceIls).toBeCloseTo(r.sellingPricePerUnitIls * r.quantity, 2);
  });

  it("molds are a separate one-time line: total = ceil(unit) × qty + molds, unit unchanged", () => {
    const base = calculateQuote(form(), CFG)!;
    const molds = calculateQuote(form({ moldsCostCny: 2000 }), CFG)!;
    expect(molds.moldsTotalCny).toBe(2000);
    expect(molds.moldsTotalSellingPriceIls).toBeCloseTo((2000 / 7.2) * 3.6, 2);
    expect(molds.moldsTotalProfitIls).toBe(0);
    expect(molds.sellingPricePerUnitIls).toBe(base.sellingPricePerUnitIls);
    expect(molds.profitPerUnitIls).toBe(base.profitPerUnitIls);
    expect(molds.totalOrderPriceIls).toBeCloseTo(
      ceilAgorot(molds.sellingPricePerUnitIls) * molds.quantity + molds.moldsTotalSellingPriceIls,
      2
    );
    expect(molds.totalOrderPriceIls - base.totalOrderPriceIls).toBeCloseTo(molds.moldsTotalSellingPriceIls, 2);
  });

  // Eli 2026-08-03 — "מרווח מיקוח"
  it("negotiation buffer is added BEFORE the round-up and flows into profit", () => {
    const zero = calculateQuote(form(), appConfig({ adminSettings: { globalProfitMargin: 40, negotiationBufferAgorot: 0 } }))!;
    const seven = calculateQuote(form(), appConfig({ adminSettings: { globalProfitMargin: 40, negotiationBufferAgorot: 7 } }))!;
    expect(seven.sellingPricePerUnitIls - zero.sellingPricePerUnitIls).toBeCloseTo(0.07, 2);
    expect(seven.sellingPricePerUnitIls - zero.sellingPricePerUnitIls).toBeGreaterThanOrEqual(0.07 - 1e-9);
    expect(seven.negotiationBufferPerUnitIls).toBe(0.07);
    expect(zero.negotiationBufferPerUnitIls).toBe(0);
    expect(seven.profitPerUnitIls - zero.profitPerUnitIls).toBeCloseTo(0.07, 2);
    expect(seven.totalProfitIls).toBeGreaterThan(zero.totalProfitIls);
    expect(seven.totalCostPerUnitIls).toBe(zero.totalCostPerUnitIls);
  });

  it("margin is margin-on-price over the bag (shipping pass-through)", () => {
    const r = calculateQuote(form(), CFG)!;
    const shipIls = r.shippingPerUnitUsd * 3.6;
    const productPrice = r.sellingPricePerUnitIls - shipIls;
    const bagCost = r.totalCostPerUnitIls - shipIls;
    // within the agora round-up
    expect((productPrice - bagCost) / productPrice).toBeCloseTo(0.4, 1);
  });
});

describe("calculateQuote — lamination gradient (scripts/_verify-lamination-gradient.ts)", () => {
  it("for every product × handles the 5,000 total never drops below the 3,000 total", () => {
    let checked = 0;
    for (const p of CFG.products) {
      for (const hasHandles of [true, false]) {
        const lam = hasHandles ? p.withHandles.laminationPrices : p.withoutHandles.laminationPrices;
        if (!lam || lam["3000"] == null || lam["5000"] == null) continue;
        const q = (qty: number) =>
          calculateQuote(
            form({ productId: p.id, hasHandles, quantityTierId: null, quantityOverride: qty, selectedFeatureIds: ["f1"], shippingOptionId: "s1" }),
            CFG
          )!;
        expect(q(5000).totalOrderPriceIls, `${p.id} handles=${hasHandles}`).toBeGreaterThanOrEqual(q(3000).totalOrderPriceIls);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("calculateQuote — lamination + plate fee", () => {
  it("lamination uses laminationPrices and prices colours as a per-order plate fee", () => {
    const r = calculateQuote(form({ selectedFeatureIds: ["f1"], logoColors: 2 }), CFG)!;
    expect(r.basePriceCny).toBe(p2.withHandles.laminationPrices!["5000"]);
    expect(r.logoAddonCny).toBe(0);
    // product's own fee ¥290 × 2 / 5000
    expect(r.plateFeeCny).toBeCloseTo((290 * 2) / 5000, 2);
    expect(r.laminationAddonCny).toBeCloseTo(0.69 - 0.65, 2);
    expect(r.selectedFeatures.map((f) => f.id)).toEqual(["f1"]);
  });

  it("the settings plate fee wins over the product catalog value", () => {
    const cfg = appConfig({ adminSettings: { globalProfitMargin: 40, laminationPlateFeePerColorCny: 500 } });
    const r = calculateQuote(form({ selectedFeatureIds: ["f1"], logoColors: 2 }), cfg)!;
    expect(r.plateFeeCny).toBeCloseTo((500 * 2) / 5000, 2);
  });

  it("no lamination → no plate fee, colour add-on from the table instead", () => {
    const r = calculateQuote(form({ logoColors: 2 }), CFG)!;
    expect(r.plateFeeCny).toBe(0);
    expect(r.logoAddonCny).toBe(0.09);
  });
});

describe("colour add-on (scripts/_verify-lamination-colors.ts)", () => {
  it("engine: the add-on is strictly increasing from 1 to 6 colours", () => {
    let prev = -1;
    for (const colors of [1, 2, 3, 4, 5, 6]) {
      const r = calculateQuote(form({ logoColors: colors }), CFG)!;
      expect(r.logoAddonCny, `${colors} colours`).toBeGreaterThan(prev);
      prev = r.logoAddonCny;
    }
  });

  // Eli 2026-09-10: past the table each extra colour adds the last known step.
  it("colorAddonFromTable continues the last step past the table", () => {
    const table = colorTableFromRecord({ "2": 0.09, "3": 0.21 });
    expect(colorAddonFromTable(table, 1)).toBe(0);
    expect(colorAddonFromTable(table, 2)).toBe(0.09);
    expect(colorAddonFromTable(table, 3)).toBe(0.21);
    expect(colorAddonFromTable(table, 4)).toBeCloseTo(0.33, 6);
    expect(colorAddonFromTable(table, 5)).toBeCloseTo(0.45, 6);
    expect(colorAddonFromTable(table, 0)).toBe(0);
    expect(colorAddonFromTable(table, NaN)).toBe(0);
  });

  it("colorAddonFromTable: a gap inside the table takes the next row up", () => {
    const table = new Map<number, number>([[1, 0], [3, 0.3]]);
    expect(colorAddonFromTable(table, 2)).toBe(0.3);
    expect(colorAddonFromTable(new Map(), 3)).toBe(0);
    expect(colorAddonFromTable(new Map([[3, 0.3]]), 5)).toBe(0.3);
  });

  it("colorTableFromRecord always carries 1 → ¥0 and drops junk keys", () => {
    const t = colorTableFromRecord({ "2": 0.1, x: 5, "0": 1 });
    expect(t.get(1)).toBe(0);
    expect(t.get(2)).toBe(0.1);
    expect(t.has(0)).toBe(false);
    expect(colorTableFromRecord(null).size).toBe(1);
  });
});

describe("resolveLamination (2026-09-10 — a default from 4 colours, not a lock)", () => {
  it.each([
    [null, 3, false],
    [null, 4, true],
    [false, 4, false],
    [true, 2, true],
    [undefined, 6, true],
  ] as const)("chosen=%s colours=%d → %s", (chosen, colors, want) => {
    expect(resolveLamination(chosen, colors)).toBe(want);
  });

  it("suggestsLamination threshold", () => {
    expect(LAMINATION_DEFAULT_FROM_COLORS).toBe(4);
    expect(suggestsLamination(3)).toBe(false);
    expect(suggestsLamination(4)).toBe(true);
    expect(suggestsLamination(NaN)).toBe(false);
  });
});

describe("calculateQuote — thermal lining (שומר קור, 2026-09-10)", () => {
  const base = form({ selectedFeatureIds: ["f1"], logoColors: 2, moldsCostCny: 2000 });
  const off = calculateQuote(base, CFG)!;
  const on = calculateQuote({ ...base, thermalLining: true }, CFG)!;

  it("+10% on the bag (base + colours), plate term outside", () => {
    const bagOff = off.unitProductionCny - off.plateFeeCny;
    expect(on.unitProductionCny - on.plateFeeCny).toBeCloseTo(bagOff * 1.1, 2);
    expect(on.thermalLining).toBe(true);
    expect(on.thermalAddonCny).toBeCloseTo(bagOff * 0.1, 3);
    expect(off.thermalLining).toBe(false);
    expect(off.thermalAddonCny).toBe(0);
  });

  it("plate fee, shipping and molds are unchanged; customer price rises", () => {
    expect(on.plateFeeCny).toBe(off.plateFeeCny);
    expect(on.shippingPerUnitUsd).toBe(off.shippingPerUnitUsd);
    expect(on.moldsTotalSellingPriceIls).toBe(off.moldsTotalSellingPriceIls);
    expect(on.sellingPricePerUnitIls).toBeGreaterThan(off.sellingPricePerUnitIls);
  });
});

describe("calculateQuote — shipping", () => {
  function expectedAir(c: typeof BULKY_CARTON) {
    const cartons = Math.ceil(AIR_QTY / c.qty);
    const actual = c.weightKg * cartons;
    const cbm = ((c.lengthCm * c.widthCm * c.heightCm) / 1_000_000) * cartons;
    const charge = Math.max(actual, cbm * KG_PER_CBM);
    const rate = charge <= AIR_RATES.thresholdKg ? AIR_RATES.rateBelowThreshold : AIR_RATES.rateAboveThreshold;
    return { perUnitUsd: (charge * rate) / AIR_QTY, cbm, charge };
  }
  function engine(carton: typeof BULKY_CARTON, shippingOptionId: string) {
    return calculateQuote(
      { productId: "p1", quantityTierId: "q0", quantityOverride: AIR_QTY, hasHandles: false, logoColors: 0, shippingOptionId, selectedFeatureIds: [] },
      airTestAppConfig(carton)
    )!;
  }

  it("air bills chargeable weight = max(actual, cbm × 167)", () => {
    for (const c of [BULKY_CARTON, DENSE_CARTON]) {
      const r = engine(c, "s-air");
      const exp = expectedAir(c);
      expect(r.shippingPerUnitUsd).toBeCloseTo(exp.perUnitUsd, 1);
      expect(r.chargeableWeightKg).toBeCloseTo(exp.charge, 1);
      expect(r.volumetricWeightKg).toBeCloseTo(exp.cbm * KG_PER_CBM, 1);
      expect(r.shipmentTotalUsd).toBeCloseTo(exp.perUnitUsd * AIR_QTY, 1);
    }
  });

  it("sea without a carrier = max(cbm, 1) × seaRate", () => {
    for (const c of [BULKY_CARTON, DENSE_CARTON]) {
      const exp = expectedAir(c);
      expect(engine(c, "s-sea").shippingPerUnitUsd).toBeCloseTo((Math.max(exp.cbm, 1) * 500) / AIR_QTY, 1);
    }
  });

  it("with the catalog config, sea rides the tiered carrier and is cheaper than air", () => {
    const sea = calculateQuote(form({ shippingOptionId: "s2" }), CFG)!;
    const air = calculateQuote(form({ shippingOptionId: "s1" }), CFG)!;
    expect(sea.shippingOption?.id).toBe("s2");
    expect(sea.shippingPerUnitUsd).toBeGreaterThan(0);
    expect(air.shippingPerUnitUsd).toBeGreaterThan(sea.shippingPerUnitUsd);
    // shipping never changes production cost or the margin base
    expect(sea.unitProductionCny).toBe(air.unitProductionCny);
    const flat = calculateQuote(form({ shippingOptionId: "s2" }), flatSeaAppConfig())!;
    expect(flat.shippingPerUnitUsd).not.toBe(sea.shippingPerUnitUsd);
  });

  it("an unknown shipping id prices no shipping (the engine has no fallback)", () => {
    const r = calculateQuote(form({ shippingOptionId: "zzz" }), CFG)!;
    expect(r.shippingOption).toBeNull();
    expect(r.shippingPerUnitUsd).toBe(0);
  });

  it("USD→ILS is applied to the final unit cost", () => {
    const cfg: AppConfig = appConfig({ exchangeRates: { usdToIls: 4, usdToCny: 7.2 } });
    const r = calculateQuote(form(), cfg)!;
    expect(r.finalUnitCostIls).toBeCloseTo(r.finalUnitCostUsd * 4, 1);
  });

  it(`${AIR_USD_TO_ILS} is the fixture rate used above`, () => {
    expect(airTestAppConfig(BULKY_CARTON).exchangeRates.usdToIls).toBe(AIR_USD_TO_ILS);
  });
});

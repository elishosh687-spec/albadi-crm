import { describe, expect, it } from "vitest";
import {
  marginPctFromUnitPrice,
  priceFactoryQuote,
  resolveShippingOption,
} from "./pricing";
import { seaPerOrderUsd, YEADIM_CARRIER } from "./sea-carriers";
import type { FactoryPricingConfig } from "./types";
import {
  AIR_QTY,
  AIR_RATES,
  AIR_TEST_FACTORY_CONFIG,
  AIR_USD_TO_ILS,
  BULKY_CARTON,
  DENSE_CARTON,
  FLAT_SEA_FACTORY_CONFIG,
  FOIL_CARTON,
  FOIL_ORDER,
  SEA_ID,
  AIR_ID,
  TIERED_FACTORY_CONFIG,
  tieredFactoryConfig,
} from "@/tests/fixtures/factory-config";

const KG_PER_CBM = 167;

describe("resolveShippingOption", () => {
  it("returns the exact id when it exists", () => {
    expect(resolveShippingOption(SEA_ID, TIERED_FACTORY_CONFIG)?.id).toBe(SEA_ID);
    expect(resolveShippingOption(AIR_ID, TIERED_FACTORY_CONFIG)?.id).toBe(AIR_ID);
  });

  // 2026-08-11 — PUGPA6BQ: the calculator's "s2" was unknown to the factory
  // config and the quote went out with ₪0 shipping (~₪1,900 under on 3,000 bags).
  it("translates the calculator's legacy ids: s1 → air, s2 → sea", () => {
    expect(resolveShippingOption("s2", TIERED_FACTORY_CONFIG)?.type).toBe("sea");
    expect(resolveShippingOption("s2", TIERED_FACTORY_CONFIG)?.id).toBe(SEA_ID);
    expect(resolveShippingOption("s1", TIERED_FACTORY_CONFIG)?.type).toBe("air");
    expect(resolveShippingOption(" s2 ", TIERED_FACTORY_CONFIG)?.id).toBe(SEA_ID);
  });

  it("falls back to a sea-ish option for an unknown id — never to no shipping", () => {
    const opt = resolveShippingOption("does-not-exist", TIERED_FACTORY_CONFIG);
    expect(opt).not.toBeNull();
    expect(opt?.type).toBe("sea");
  });

  it("falls back to the first option when nothing looks like sea", () => {
    const cfg: FactoryPricingConfig = {
      ...TIERED_FACTORY_CONFIG,
      shippingOptions: [
        { id: "x1", name: "Rocket", type: "air", enabled: true, airRates: AIR_RATES },
      ],
    };
    expect(resolveShippingOption("nope", cfg)?.id).toBe("x1");
  });

  it("returns null only when there are no options at all", () => {
    expect(resolveShippingOption("s2", { ...TIERED_FACTORY_CONFIG, shippingOptions: [] })).toBeNull();
  });
});

describe("priceFactoryQuote — shipping", () => {
  // 2026-08-11 regression: "s2" against a sea-standard/air-express config.
  it("never prices shipping at ₪0 for the legacy s2 id", () => {
    const legacy = priceFactoryQuote({ ...FOIL_ORDER, shippingOptionId: "s2" }, TIERED_FACTORY_CONFIG);
    const canonical = priceFactoryQuote({ ...FOIL_ORDER, shippingOptionId: SEA_ID }, TIERED_FACTORY_CONFIG);
    expect(legacy.totalShipping).toBeGreaterThan(0);
    expect(legacy.totalShipping).toBe(canonical.totalShipping);
    expect(legacy.shippingOptionId).toBe(SEA_ID);
    expect(legacy.unitSellingPrice).toBe(canonical.unitSellingPrice);
  });

  it("charges nothing when no shipping option is given", () => {
    const r = priceFactoryQuote({ ...FOIL_ORDER, shippingOptionId: null }, TIERED_FACTORY_CONFIG);
    expect(r.totalShipping).toBe(0);
    expect(r.shippingOptionId).toBeNull();
  });

  function expectedAirPerUnitUsd(c: typeof BULKY_CARTON) {
    const cartons = Math.ceil(AIR_QTY / c.qty);
    const actual = c.weightKg * cartons;
    const cbm = ((c.lengthCm * c.widthCm * c.heightCm) / 1_000_000) * cartons;
    const charge = Math.max(actual, cbm * KG_PER_CBM);
    const rNew = charge <= AIR_RATES.thresholdKg ? AIR_RATES.rateBelowThreshold : AIR_RATES.rateAboveThreshold;
    const rOld = actual <= AIR_RATES.thresholdKg ? AIR_RATES.rateBelowThreshold : AIR_RATES.rateAboveThreshold;
    return { oldUsd: (actual * rOld) / AIR_QTY, newUsd: (charge * rNew) / AIR_QTY, cbm };
  }
  function airPerUnitUsd(carton: typeof BULKY_CARTON, id: string): number {
    const r = priceFactoryQuote(
      { factoryUnitCostCny: 5, quantity: AIR_QTY, shippingOptionId: id, cartonSpec: carton },
      AIR_TEST_FACTORY_CONFIG
    );
    return r.unitShipping / AIR_USD_TO_ILS;
  }

  it("air bills chargeable weight = max(actual, cbm × 167): bulky cargo pays by volume", () => {
    const exp = expectedAirPerUnitUsd(BULKY_CARTON);
    expect(airPerUnitUsd(BULKY_CARTON, "s-air")).toBeCloseTo(exp.newUsd, 1);
    expect(exp.newUsd).toBeGreaterThan(exp.oldUsd + 0.01);
  });

  it("air: dense cargo is billed on its physical weight (regression guard)", () => {
    const exp = expectedAirPerUnitUsd(DENSE_CARTON);
    expect(airPerUnitUsd(DENSE_CARTON, "s-air")).toBeCloseTo(exp.newUsd, 1);
    expect(exp.newUsd).toBeCloseTo(exp.oldUsd, 6);
  });

  it("exposes the precise chargeable weight", () => {
    const r = priceFactoryQuote(
      { factoryUnitCostCny: 5, quantity: AIR_QTY, shippingOptionId: "s-air", cartonSpec: BULKY_CARTON },
      AIR_TEST_FACTORY_CONFIG
    );
    expect(r.chargeableWeightKg).toBeCloseTo(2.16 * KG_PER_CBM, 1);
    expect(r.totalCbm).toBeCloseTo(2.16, 2);
    expect(r.totalCartons).toBe(10);
  });

  it("sea without a carrier = max(cbm, 1) × seaRate (1-CBM floor)", () => {
    for (const c of [BULKY_CARTON, DENSE_CARTON]) {
      const exp = expectedAirPerUnitUsd(c);
      const want = (Math.max(exp.cbm, 1) * 500) / AIR_QTY;
      expect(airPerUnitUsd(c, "s-sea")).toBeCloseTo(want, 1);
    }
  });

  it("sea with the tiered carrier bills a small order at the assumed 3-CBM rate", () => {
    const r = priceFactoryQuote({ ...FOIL_ORDER, moldsCostCny: 0 }, TIERED_FACTORY_CONFIG);
    const cartons = Math.ceil(5000 / FOIL_CARTON.qty);
    const cbm = cartons * ((48 * 41 * 45) / 1e6);
    expect(r.totalCbm).toBeCloseTo(cbm, 2);
    const sea = seaPerOrderUsd(YEADIM_CARRIER, cbm, { assumedCbm: 3 });
    expect(sea.assumedBasisUsed).toBe(true);
    expect(r.unitShipping).toBeCloseTo((sea.shipmentUsd * TIERED_FACTORY_CONFIG.usdToIls) / 5000, 2);
    expect(r.totalShipping).toBeCloseTo(sea.shipmentUsd * TIERED_FACTORY_CONFIG.usdToIls, 0);
  });

  it("seaUseTrueCost prices a small order on its own (dearer) volume", () => {
    const assumed = priceFactoryQuote(FOIL_ORDER, TIERED_FACTORY_CONFIG);
    const own = priceFactoryQuote({ ...FOIL_ORDER, seaUseTrueCost: true }, TIERED_FACTORY_CONFIG);
    expect(own.totalShipping).toBeGreaterThan(assumed.totalShipping);
  });

  it("totalCbmOverride replaces the dimension-derived volume for shipping only", () => {
    const r = priceFactoryQuote({ ...FOIL_ORDER, totalCbmOverride: 3 }, FLAT_SEA_FACTORY_CONFIG);
    expect(r.totalCbm).toBe(3);
    expect(r.totalShipping).toBeCloseTo(3 * 500 * FLAT_SEA_FACTORY_CONFIG.usdToIls, 2);
    // weight is untouched (air pricing is weight-based)
    expect(r.totalWeightKg).toBe(17 * 25);
  });
});

describe("priceFactoryQuote — the foil order (¥1.27 · 5,000)", () => {
  const cfg = TIERED_FACTORY_CONFIG;
  const r = priceFactoryQuote(FOIL_ORDER, cfg);
  const cnyToIls = (cny: number) => (cny / cfg.usdToCny) * cfg.usdToIls;

  it("converts the factory cost CNY → USD → ILS", () => {
    expect(r.unitCost).toBeCloseTo(cnyToIls(1.27), 2);
    expect(r.quantity).toBe(5000);
    expect(r.currency).toBe("ILS");
  });

  it("margin is margin-on-price over the bag only (shipping + plate are pass-through)", () => {
    const productPrice = r.unitCost + r.unitProfit;
    expect(r.unitProfit / productPrice).toBeCloseTo(0.4, 2);
    expect(r.profitMarginPct).toBe(40);
    const exact = r.unitCost / 0.6 + r.unitShipping + (r.platePerUnitIls ?? 0);
    // rounded UP to the agora, never down
    expect(r.unitSellingPrice).toBeGreaterThanOrEqual(exact - 0.011);
    expect(r.unitSellingPrice).toBeLessThanOrEqual(exact + 0.011);
    expect(Math.round(r.unitSellingPrice * 100)).toBe(r.unitSellingPrice * 100);
  });

  it("plate fee = ¥530 × 2 colours, pass-through per unit", () => {
    expect(r.plateFeeTotalCny).toBe(1060);
    expect(r.plateFeeLogoColors).toBe(2);
    expect(r.platePerUnitIls).toBeCloseTo(cnyToIls(1060 / 5000), 2);
    expect(r.plateFeeTotalCostIls).toBeCloseTo(cnyToIls(1060), 2);
    const noPlate = priceFactoryQuote({ ...FOIL_ORDER, platePerColorCny: 0 }, cfg);
    expect(noPlate.plateFeeTotalCny).toBeUndefined();
    expect(r.unitSellingPrice - noPlate.unitSellingPrice).toBeCloseTo(cnyToIls(1060 / 5000), 1);
  });

  it("molds are a one-time pass-through line, never in the per-unit price", () => {
    const noMolds = priceFactoryQuote({ ...FOIL_ORDER, moldsCostCny: 0 }, cfg);
    expect(r.moldsTotalCny).toBe(1000);
    expect(r.moldsTotalSellingPriceIls).toBeCloseTo(cnyToIls(1000), 2);
    expect(r.moldsTotalCostIls).toBe(r.moldsTotalSellingPriceIls);
    expect(r.moldsTotalProfitIls).toBe(0);
    expect(r.unitSellingPrice).toBe(noMolds.unitSellingPrice);
    expect(r.unitProfit).toBe(noMolds.unitProfit);
    expect(r.totalSellingPrice - noMolds.totalSellingPrice).toBeCloseTo(cnyToIls(1000), 2);
    expect(noMolds.moldsTotalSellingPriceIls).toBe(0);
  });

  it("totals derive from the ROUNDED per-bag price × qty (+ molds)", () => {
    expect(r.totalSellingPrice).toBeCloseTo(r.unitSellingPrice * 5000 + r.moldsTotalSellingPriceIls, 2);
    // unitShipping is rounded to the agora in the result; the total is exact —
    // so they agree only to within half an agora × qty.
    expect(Math.abs(r.totalShipping - r.unitShipping * 5000)).toBeLessThan(0.005 * 5000);
    // profit reconciles with price − cost: the round-up goes to margin
    const revenue = r.totalSellingPrice;
    const cost = r.totalCost + r.totalShipping;
    expect(r.totalProfit).toBeCloseTo(revenue - cost, 0);
  });

  it("echoes commission from the config", () => {
    expect(r.commissionPct).toBe(cfg.commissionPct);
  });
});

describe("priceFactoryQuote — thermal lining (שומר קור, 2026-09-10)", () => {
  const cfg = TIERED_FACTORY_CONFIG;
  const off = priceFactoryQuote(FOIL_ORDER, cfg);
  const on = priceFactoryQuote({ ...FOIL_ORDER, thermalLining: true }, cfg);

  it("+10% on the bag cost only", () => {
    expect(on.unitCost).toBeCloseTo(off.unitCost * 1.1, 2);
    expect(on.thermalLining).toBe(true);
    expect(on.thermalAddonCny).toBeCloseTo(0.127, 3);
  });

  it("shipping, plate fee and molds are identical with and without it", () => {
    expect(on.totalShipping).toBe(off.totalShipping);
    expect(on.unitShipping).toBe(off.unitShipping);
    expect(on.plateFeeTotalCostIls).toBe(off.plateFeeTotalCostIls);
    expect(on.platePerUnitIls).toBe(off.platePerUnitIls);
    expect(on.moldsTotalSellingPriceIls).toBe(off.moldsTotalSellingPriceIls);
  });

  it("off → no thermal fields at all", () => {
    expect(off.thermalLining).toBeUndefined();
    expect(off.thermalAddonCny).toBeUndefined();
  });

  it("customer price rises", () => {
    expect(on.unitSellingPrice).toBeGreaterThan(off.unitSellingPrice);
  });
});

describe("priceFactoryQuote — negotiation buffer (מרווח מיקוח, 2026-08-03)", () => {
  it("adds N agorot per bag before the round-up and flows into profit", () => {
    const base = priceFactoryQuote(FOIL_ORDER, tieredFactoryConfig({ negotiationBufferAgorot: 0 }));
    const padded = priceFactoryQuote(FOIL_ORDER, tieredFactoryConfig({ negotiationBufferAgorot: 7 }));
    expect(padded.unitSellingPrice - base.unitSellingPrice).toBeCloseTo(0.07, 2);
    expect(padded.negotiationBufferPerUnitIls).toBe(0.07);
    expect(base.negotiationBufferPerUnitIls).toBe(0);
    expect(padded.totalProfit - base.totalProfit).toBeCloseTo(0.07 * 5000, 0);
    // cost side is untouched
    expect(padded.unitCost).toBe(base.unitCost);
    expect(padded.totalShipping).toBe(base.totalShipping);
  });

  it("a negative buffer is treated as off", () => {
    const base = priceFactoryQuote(FOIL_ORDER, tieredFactoryConfig({ negotiationBufferAgorot: 0 }));
    const neg = priceFactoryQuote(FOIL_ORDER, tieredFactoryConfig({ negotiationBufferAgorot: -5 }));
    expect(neg.unitSellingPrice).toBe(base.unitSellingPrice);
  });
});

describe("priceFactoryQuote — margin override", () => {
  it("profitMarginOverride wins over the config default and is clamped below 100", () => {
    const r30 = priceFactoryQuote({ ...FOIL_ORDER, profitMarginOverride: 30 }, TIERED_FACTORY_CONFIG);
    const r40 = priceFactoryQuote(FOIL_ORDER, TIERED_FACTORY_CONFIG);
    expect(r30.profitMarginPct).toBe(30);
    expect(r30.unitSellingPrice).toBeLessThan(r40.unitSellingPrice);
    const r100 = priceFactoryQuote({ ...FOIL_ORDER, profitMarginOverride: 100 }, TIERED_FACTORY_CONFIG);
    expect(Number.isFinite(r100.unitSellingPrice)).toBe(true);
    expect(r100.unitSellingPrice).toBeGreaterThan(r40.unitSellingPrice);
  });
});

describe("marginPctFromUnitPrice", () => {
  // Cases from scripts/_sell-at-150.ts — selling at ₪1.50 with the landed cost split
  // into bag / shipping / plates; the "system" convention is margin on the BAG price.
  it.each([
    { name: "real factory cost", bag: 0.5697, ship: 0.4009, plate: 0.0951 },
    { name: "estimator cost", bag: 0.5024, ship: 0.4862, plate: 0.0946 },
  ])("$name — margin on the bag-only price", ({ bag, ship, plate }) => {
    const sell = 1.5;
    const productPrice = sell - (ship + plate);
    const want = ((productPrice - bag) / productPrice) * 100;
    expect(marginPctFromUnitPrice(sell, bag, ship + plate)).toBeCloseTo(want, 6);
  });

  it("is the inverse of the forward formula", () => {
    const cfg = TIERED_FACTORY_CONFIG;
    const r = priceFactoryQuote({ ...FOIL_ORDER, moldsCostCny: 0 }, cfg);
    const m = marginPctFromUnitPrice(r.unitSellingPrice, r.unitCost, r.unitShipping + (r.platePerUnitIls ?? 0));
    // within the agora round-up of the selling price
    expect(m).toBeGreaterThanOrEqual(40 - 0.01);
    expect(m).toBeLessThan(41);
  });

  it("returns 0 when shipping eats the whole price", () => {
    expect(marginPctFromUnitPrice(1, 0.5, 1)).toBe(0);
    expect(marginPctFromUnitPrice(1, 0.5, 2)).toBe(0);
  });

  it("goes negative when the price is below cost", () => {
    expect(marginPctFromUnitPrice(1, 2, 0)).toBe(-100);
  });
});

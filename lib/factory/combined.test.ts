import { describe, expect, it } from "vitest";
import {
  allocateCombined,
  combinedShippingIls,
  computeCombined,
  defaultMarginFor,
  priceQuoteForCombine,
  resolveMergedShippingOption,
  type CombinedItemInput,
} from "./combined";
import { priceFactoryQuote } from "./pricing";
import { customerTotalExVat } from "./customer-total";
import { seaPerOrderUsd, YEADIM_CARRIER } from "./sea-carriers";
import type { FactoryPricingResult, FactoryProductSpec, FactoryResponse } from "./types";
import { AIR_ID, FOIL_ORDER, SEA_ID, TIERED_FACTORY_CONFIG, tieredFactoryConfig } from "@/tests/fixtures/factory-config";

const cfg = TIERED_FACTORY_CONFIG;
const seaOpt = cfg.shippingOptions.find((s) => s.id === SEA_ID)!;
const airOpt = cfg.shippingOptions.find((s) => s.id === AIR_ID)!;

const A = priceFactoryQuote({ ...FOIL_ORDER, moldsCostCny: 0 }, cfg);
const B = priceFactoryQuote(
  {
    factoryUnitCostCny: 0.9,
    quantity: 3000,
    shippingOptionId: SEA_ID,
    cartonSpec: { qty: 250, weightKg: 8, lengthCm: 45, widthCm: 34, heightCm: 48 },
    moldsCostCny: 1000,
  },
  cfg
);
const items = [
  { id: "A", pricing: A },
  { id: "B", pricing: B },
];
const separateCustomerTotal = (customerTotalExVat(A) ?? 0) + (customerTotalExVat(B) ?? 0);
const sumShipping = (r: { perProduct: { adjusted: FactoryPricingResult }[] }) =>
  r.perProduct.reduce((s, p) => s + p.adjusted.totalShipping, 0);

describe("combinedShippingIls", () => {
  it("sea rides the active carrier's per-order rule", () => {
    const usd = seaPerOrderUsd(YEADIM_CARRIER, 2.5, { assumedCbm: 3 }).shipmentUsd;
    expect(combinedShippingIls(2.5, 100, seaOpt, cfg)).toBeCloseTo(usd * cfg.usdToIls, 2);
  });

  it("sea without a carrier = max(cbm, 1) × seaRate", () => {
    const flat = tieredFactoryConfig({ seaCarriers: [], activeSeaCarrierId: undefined });
    expect(combinedShippingIls(0.5, 100, seaOpt, flat)).toBeCloseTo(500 * flat.usdToIls, 2);
    expect(combinedShippingIls(2, 100, seaOpt, flat)).toBeCloseTo(1000 * flat.usdToIls, 2);
  });

  it("air uses the weight tiers", () => {
    expect(combinedShippingIls(1, 50, airOpt, cfg)).toBeCloseTo(50 * 8.5 * cfg.usdToIls, 2);
    expect(combinedShippingIls(1, 200, airOpt, cfg)).toBeCloseTo(200 * 6.5 * cfg.usdToIls, 2);
  });

  it("no option → ₪0", () => {
    expect(combinedShippingIls(2, 100, null, cfg)).toBe(0);
    expect(combinedShippingIls(2, 100, undefined, cfg)).toBe(0);
  });
});

describe("allocateCombined", () => {
  // Eli 2026-08-02: "איך הגיוני שההצעה המשולבת תהיה יותר גבוהה?"
  it("a combined offer never costs more than the quotes it merges", () => {
    const r = allocateCombined(items, seaOpt, cfg);
    expect(r.grandTotal).toBeLessThanOrEqual(separateCustomerTotal);
    expect(r.perProduct.map((p) => p.id)).toEqual(["A", "B"]);
    for (const { id, adjusted } of r.perProduct) {
      const orig = items.find((i) => i.id === id)!.pricing;
      expect(adjusted.quantity).toBe(orig.quantity);
      expect(adjusted.unitCost).toBe(orig.unitCost);
      expect(adjusted.moldsTotalSellingPriceIls).toBe(orig.moldsTotalSellingPriceIls);
    }
    expect(r.airIls).toBeUndefined();
    expect(r.seaIls).toBeUndefined();
  });

  it("merged shipping is capped at what the products already pay separately", () => {
    const r = allocateCombined(items, seaOpt, cfg);
    const own = A.totalShipping + B.totalShipping;
    expect(sumShipping(r)).toBeLessThanOrEqual(own + 0.02);
  });

  it("the grand total is summed like the PDF: rounded per-unit × qty + molds", () => {
    const r = allocateCombined(items, seaOpt, cfg);
    const want = r.perProduct.reduce(
      (s, { adjusted: a }) => s + Math.round(a.unitSellingPrice * a.quantity * 100) / 100 + (a.moldsTotalSellingPriceIls ?? 0),
      0
    );
    expect(r.grandTotal).toBeCloseTo(want, 2);
  });

  it("returns the untouched pricings when merging does not lower the price", () => {
    // Items that carry no shipping of their own: merged freight is capped at 0,
    // so nothing can get cheaper and the customer keeps the prices he holds.
    const noShip = items.map(({ id, pricing }) => ({ id, pricing: { ...pricing, totalShipping: 0, unitShipping: 0 } }));
    const r = allocateCombined(noShip, seaOpt, cfg);
    expect(r.perProduct[0].adjusted).toBe(noShip[0].pricing);
    expect(r.perProduct[1].adjusted).toBe(noShip[1].pricing);
    expect(r.grandTotal).toBeCloseTo((customerTotalExVat(noShip[0].pricing) ?? 0) + (customerTotalExVat(noShip[1].pricing) ?? 0), 2);
  });

  it("cbmOverride recomputes shipping on the override and skips the cap", () => {
    for (const cbm of [1, 10]) {
      const r = allocateCombined(items, seaOpt, cfg, undefined, cbm);
      const want = combinedShippingIls(cbm, A.totalWeightKg + B.totalWeightKg, seaOpt, cfg);
      expect(sumShipping(r)).toBeCloseTo(want, 1);
      // allocation by each product's own CBM share
      const share = A.totalCbm / (A.totalCbm + B.totalCbm);
      expect(r.perProduct[0].adjusted.totalShipping).toBeCloseTo(want * share, 1);
    }
    const big = allocateCombined(items, seaOpt, cfg, undefined, 10);
    expect(big.grandTotal).toBeGreaterThan(separateCustomerTotal);
  });

  it("per-product price folds the allocated shipping into a rounded-up bag price", () => {
    const r = allocateCombined(items, seaOpt, cfg, undefined, 1);
    for (const { adjusted: a } of r.perProduct) {
      expect(a.unitSellingPrice).toBe(Math.ceil(a.unitSellingPrice * 100 - 1e-9) / 100);
      expect(a.unitShipping).toBeCloseTo(a.totalShipping / a.quantity, 2);
      expect(a.shippingOptionName).toBe(seaOpt.name);
    }
  });

  it("a split prices each leg on its own option and names them", () => {
    const r = allocateCombined(items, seaOpt, cfg, { airIds: ["A"], airShippingOptionId: AIR_ID, seaShippingOptionId: SEA_ID });
    expect(r.airIls).toBeCloseTo(combinedShippingIls(A.totalCbm, A.totalWeightKg, airOpt, cfg), 1);
    expect(r.seaIls).toBeCloseTo(combinedShippingIls(B.totalCbm, B.totalWeightKg, seaOpt, cfg), 1);
    expect(r.airName).toBe(airOpt.name);
    expect(r.seaName).toBe(seaOpt.name);
    const a = r.perProduct.find((p) => p.id === "A")!.adjusted;
    const b = r.perProduct.find((p) => p.id === "B")!.adjusted;
    expect(a.shippingOptionName).toBe(airOpt.name);
    expect(b.shippingOptionName).toBe(seaOpt.name);
    expect(a.totalShipping).toBeCloseTo(r.airIls!, 1);
    expect(b.totalShipping).toBeCloseTo(r.seaIls!, 1);
  });

  it("a split with every item on one leg is not a split", () => {
    const r = allocateCombined(items, seaOpt, cfg, { airIds: ["A", "B"], airShippingOptionId: AIR_ID, seaShippingOptionId: SEA_ID });
    expect(r.airIls).toBeUndefined();
    expect(r.grandTotal).toBeLessThanOrEqual(separateCustomerTotal);
  });
});

describe("computeCombined", () => {
  const inputs: CombinedItemInput[] = [A, B].map((p) => ({
    totalCost: p.totalCost,
    totalProfit: p.totalProfit,
    totalSellingPrice: p.totalSellingPrice,
    totalShipping: p.totalShipping,
    totalCbm: p.totalCbm,
    totalWeightKg: p.totalWeightKg,
  }));

  it("sums the cargo and never lets the merged shipping exceed the products' own", () => {
    const r = computeCombined(inputs, seaOpt, cfg);
    expect(r.count).toBe(2);
    expect(r.combinedCbm).toBeCloseTo(A.totalCbm + B.totalCbm, 2);
    expect(r.combinedWeightKg).toBeCloseTo(A.totalWeightKg + B.totalWeightKg, 2);
    expect(r.combinedShipping).toBeLessThanOrEqual(A.totalShipping + B.totalShipping + 0.01);
    // `separateShipping` re-prices each item TODAY via combinedShippingIls, which
    // is not byte-identical to priceFactoryQuote's own shipping line (min-CBM
    // handling differs by a few ₪) — so the saving is only guaranteed against
    // the items' OWN shipping, which is what the min() cap enforces.
    expect(r.combinedShipping).toBeLessThanOrEqual(A.totalShipping + B.totalShipping + 0.01);
    expect(r.shippingSaving).toBeCloseTo(r.separateShipping - r.combinedShipping, 2);
    expect(r.totalProduction).toBeCloseTo(A.totalCost + B.totalCost, 2);
    expect(r.totalProfit).toBeCloseTo(A.totalProfit + B.totalProfit, 2);
    expect(r.grandTotal).toBeCloseTo(r.productPriceTotal + r.combinedShipping, 2);
    expect(r.overallMarginPct).toBeCloseTo((r.totalProfit / r.productPriceTotal) * 100, 0);
  });

  it("cbmOverride replaces the summed CBM for shipping only", () => {
    const r = computeCombined(inputs, seaOpt, cfg, 10);
    expect(r.combinedCbm).toBe(10);
    expect(r.combinedShipping).toBeCloseTo(combinedShippingIls(10, r.combinedWeightKg, seaOpt, cfg), 2);
    expect(r.combinedWeightKg).toBeCloseTo(A.totalWeightKg + B.totalWeightKg, 2);
  });

  it("no option → no shipping, empty list → zeros", () => {
    expect(computeCombined(inputs, null, cfg).combinedShipping).toBe(0);
    const empty = computeCombined([], seaOpt, cfg);
    expect(empty.count).toBe(0);
    expect(empty.grandTotal).toBe(0);
    expect(empty.overallMarginPct).toBe(0);
  });
});

describe("resolveMergedShippingOption", () => {
  it("takes the first member that names a known option", () => {
    const opt = resolveMergedShippingOption([{ pricing: { ...A, shippingOptionId: null } }, { pricing: B }], cfg);
    expect(opt?.id).toBe(SEA_ID);
  });

  it("falls back to the first enabled option, else null", () => {
    expect(resolveMergedShippingOption([{ pricing: { ...A, shippingOptionId: "ghost" } }], cfg)?.id).toBe(cfg.shippingOptions[0].id);
    const none = tieredFactoryConfig({ shippingOptions: cfg.shippingOptions.map((s) => ({ ...s, enabled: false })) });
    expect(resolveMergedShippingOption([{ pricing: { ...A, shippingOptionId: null } }], none)).toBeNull();
  });
});

describe("priceQuoteForCombine / defaultMarginFor", () => {
  const spec: FactoryProductSpec = {
    quantity: 5000,
    shippingOptionId: SEA_ID,
    finishing: "With handles / Thermal lining",
  } as unknown as FactoryProductSpec;
  const resp: FactoryResponse = {
    unitCostCny: 1.27,
    cartonQty: 200,
    weightKg: 17,
    cartonLengthCm: 48,
    cartonWidthCm: 41,
    cartonHeightCm: 45,
  } as unknown as FactoryResponse;

  it("returns the saved finalPricing when there is no margin override", () => {
    expect(priceQuoteForCombine({ productSpec: spec, factoryResponse: resp, finalPricing: A }, cfg, null)).toBe(A);
    expect(priceQuoteForCombine({ productSpec: spec, factoryResponse: null, finalPricing: null }, cfg, null)).toBeNull();
  });

  it("re-prices at the override and carries thermal from the finishing string", () => {
    const r = priceQuoteForCombine({ productSpec: spec, factoryResponse: resp, finalPricing: A }, cfg, null, 30)!;
    expect(r.profitMarginPct).toBe(30);
    expect(r.thermalLining).toBe(true);
    expect(r.moldsTotalCny).toBe(0);
    expect(r.shippingOptionId).toBe(SEA_ID);
  });

  it("defaultMarginFor: finalized margin, else the matrix snapped down", () => {
    expect(defaultMarginFor({ productSpec: spec, factoryResponse: resp, finalPricing: { ...A, profitMarginPct: 35 } }, cfg)).toBe(35);
    const c = tieredFactoryConfig({ profitMarginByQuantity: { "3000": 30, "5000": 45 }, defaultProfitMargin: 40 });
    expect(defaultMarginFor({ productSpec: { ...spec, quantity: 4999 }, factoryResponse: resp, finalPricing: null }, c)).toBe(30);
    expect(defaultMarginFor({ productSpec: { ...spec, quantity: 5000 }, factoryResponse: resp, finalPricing: null }, c)).toBe(45);
    const noMatrix = tieredFactoryConfig({ profitMarginByQuantity: {}, defaultProfitMargin: 42 });
    expect(defaultMarginFor({ productSpec: spec, factoryResponse: resp, finalPricing: null }, noMatrix)).toBe(42);
  });
});

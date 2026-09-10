import { describe, expect, it } from "vitest";
import { applyShippingSplit, splitCustomerView } from "./shipping-split";
import { priceFactoryQuote } from "./pricing";
import { ceilAgorot } from "./rounding";
import type { ShippingSplit } from "./types";
import { FOIL_ORDER, TIERED_FACTORY_CONFIG } from "@/tests/fixtures/factory-config";

const SPLIT: ShippingSplit = {
  productUnitIls: 2.5,
  productTotalIls: 25000,
  airIls: 265,
  seaIls: 900,
  airLabel: "אקספרס · 1,000 יח׳",
  seaLabel: "רגיל · 9,000 יח׳",
  airQuantity: 500,
  seaQuantity: 9500,
};

describe("splitCustomerView", () => {
  // Eli 2026-07-28: "500 יח׳ אווירי × ₪3.03" — ONE all-in price per bag per leg.
  it("prices each leg as bag + that leg's shipping, rounded UP", () => {
    const v = splitCustomerView(SPLIT, 100);
    expect(v.air.quantity).toBe(500);
    expect(v.air.unitIls).toBe(ceilAgorot(2.5 + 265 / 500)); // 3.03
    expect(v.air.unitIls).toBe(3.03);
    expect(v.air.totalIls).toBe(1515);
    expect(v.sea.quantity).toBe(9500);
    expect(v.sea.unitIls).toBe(ceilAgorot(2.5 + 900 / 9500)); // 2.6
    expect(v.sea.totalIls).toBe(2.6 * 9500);
    expect(v.moldsIls).toBe(100);
    expect(v.grandTotalIls).toBe(1515 + 24700 + 100);
    expect(v.air.label).toBe(SPLIT.airLabel);
    expect(v.sea.label).toBe(SPLIT.seaLabel);
  });

  it("the leg total derives from the ROUNDED unit, so the printed arithmetic reconciles", () => {
    const v = splitCustomerView({ ...SPLIT, productUnitIls: 1, airIls: 1, airQuantity: 3, seaIls: 0, seaQuantity: 1 }, 0);
    expect(v.air.unitIls).toBe(1.34); // 1.3333… rounded up
    expect(v.air.totalIls).toBe(4.02); // not 4.00
    expect(v.sea.unitIls).toBe(1);
    expect(v.grandTotalIls).toBe(5.02);
  });

  it("parses the quantity out of the label when it is not stored (pre-2026-07-28 quotes)", () => {
    const { airQuantity: _a, seaQuantity: _s, ...legacy } = SPLIT;
    const v = splitCustomerView(legacy, 0);
    expect(v.air.quantity).toBe(1000);
    expect(v.sea.quantity).toBe(9000);
    expect(v.air.unitIls).toBe(ceilAgorot(2.5 + 265 / 1000));
  });

  it("an explicit quantity beats the label", () => {
    const v = splitCustomerView({ ...SPLIT, airLabel: "אקספרס · 999,999 יח׳" }, 0);
    expect(v.air.quantity).toBe(500);
  });

  it("a leg with no units contributes nothing and does not divide by zero", () => {
    const v = splitCustomerView({ ...SPLIT, airQuantity: 0, airLabel: "אקספרס" }, 0);
    expect(v.air.quantity).toBe(0);
    expect(v.air.unitIls).toBe(2.5);
    expect(v.air.totalIls).toBe(0);
    expect(v.grandTotalIls).toBe(v.sea.totalIls);
  });

  it("molds default to 0 and negative molds are ignored", () => {
    expect(splitCustomerView(SPLIT).moldsIls).toBe(0);
    expect(splitCustomerView(SPLIT, -5).moldsIls).toBe(0);
    expect(splitCustomerView(SPLIT, 33.339).moldsIls).toBe(33.34);
  });
});

describe("applyShippingSplit", () => {
  const pricing = priceFactoryQuote(FOIL_ORDER, TIERED_FACTORY_CONFIG);
  const out = applyShippingSplit(pricing, {
    quantity: 5000,
    airQuantity: 1000,
    seaQuantity: 4000,
    airIls: 1200,
    seaIls: 1800,
    airName: "אקספרס",
    seaName: "סטנדרט",
    airCbm: 0.45,
    seaCbm: 1.8,
  });

  it("only shipping and the totals move — production is untouched", () => {
    expect(out.totalShipping).toBe(3000);
    expect(out.unitShipping).toBe(0.6);
    expect(out.totalCost).toBe(pricing.totalCost);
    expect(out.unitCost).toBe(pricing.unitCost);
    expect(out.unitProfit).toBe(pricing.unitProfit);
    expect(out.moldsTotalSellingPriceIls).toBe(pricing.moldsTotalSellingPriceIls);
  });

  it("the split carries the bag-only price and Hebrew labels with he-IL numbers", () => {
    const s = out.shippingSplit!;
    const productUnit = Math.round((pricing.unitSellingPrice - pricing.unitShipping) * 100) / 100;
    expect(s.productUnitIls).toBe(productUnit);
    expect(s.productTotalIls).toBe(Math.round(productUnit * 5000 * 100) / 100);
    expect(s.airIls).toBe(1200);
    expect(s.seaIls).toBe(1800);
    expect(s.airQuantity).toBe(1000);
    expect(s.seaQuantity).toBe(4000);
    expect(s.airLabel).toBe(`אקספרס · ${(1000).toLocaleString("he-IL")} יח׳`);
    expect(s.seaLabel).toBe(`סטנדרט · ${(4000).toLocaleString("he-IL")} יח׳`);
    expect(s.airCbm).toBe(0.45);
    expect(s.seaCbm).toBe(1.8);
    expect(out.unitSellingPrice).toBeCloseTo(productUnit + 0.6, 2);
    expect(out.totalSellingPrice).toBeCloseTo(s.productTotalIls + 3000 + pricing.moldsTotalSellingPriceIls, 2);
  });

  it("empty names fall back to אווירי / ימי", () => {
    const o = applyShippingSplit(pricing, { quantity: 5000, airQuantity: 1, seaQuantity: 4999, airIls: 1, seaIls: 1, airName: "", seaName: "" });
    expect(o.shippingSplit!.airLabel.startsWith("אווירי ·")).toBe(true);
    expect(o.shippingSplit!.seaLabel.startsWith("ימי ·")).toBe(true);
  });

  it("the customer view of the applied split reconciles with the labels", () => {
    const v = splitCustomerView(out.shippingSplit!, out.moldsTotalSellingPriceIls);
    expect(v.air.quantity).toBe(1000);
    expect(v.sea.quantity).toBe(4000);
    expect(v.grandTotalIls).toBe(v.air.totalIls + v.sea.totalIls + v.moldsIls);
  });
});

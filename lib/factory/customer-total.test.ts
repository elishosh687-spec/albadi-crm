import { describe, expect, it } from "vitest";
import { customerTotalExVat } from "./customer-total";
import { splitCustomerView } from "./shipping-split";
import { customerRoundedTotalIls } from "./calculator/customer-breakdown";
import { ceilAgorot } from "./rounding";
import type { ShippingSplit } from "./types";

describe("customerTotalExVat", () => {
  // Eli 2026-07-31 — יוסי גולד בייבי: the list/deal/invoice read the engine's
  // unrounded ₪8,106 while the customer held a quote that said ₪8,160.
  it("the ROUNDED per-bag × qty wins over the engine's unrounded total", () => {
    const unrounded = 1.6212 * 5000; // 8106
    const t = customerTotalExVat({ unitSellingPrice: 1.6212, quantity: 5000, totalSellingPrice: unrounded });
    expect(t).toBeCloseTo(ceilAgorot(1.6212) * 5000, 2); // 1.63 × 5000 = 8150 (result is round2'd)
    expect(t).toBe(8150);
    expect(t).not.toBe(unrounded);
    expect(t).toBe(customerRoundedTotalIls(1.6212, 5000));
  });

  it("a per-bag price already on the agora is not pushed up", () => {
    expect(customerTotalExVat({ unitSellingPrice: 1.62, quantity: 5000 })).toBe(8100);
    expect(customerTotalExVat({ unitSellingPrice: 0.69, quantity: 3000 })).toBe(2070);
  });

  it("adds the one-time molds and ignores a non-positive one", () => {
    expect(customerTotalExVat({ unitSellingPrice: 1.62, quantity: 5000, moldsTotalSellingPriceIls: 513.888 })).toBe(8613.89);
    expect(customerTotalExVat({ unitSellingPrice: 1.62, quantity: 5000, moldsTotalSellingPriceIls: -10 })).toBe(8100);
    expect(customerTotalExVat({ unitSellingPrice: 1.62, quantity: 5000, moldsTotalSellingPriceIls: "abc" })).toBe(8100);
  });

  it("coerces strings straight off the API", () => {
    expect(customerTotalExVat({ unitSellingPrice: "1.62", quantity: "5000", moldsTotalSellingPriceIls: "100" })).toBe(8200);
  });

  it("a split shipment takes precedence over unit × qty", () => {
    const split: ShippingSplit = {
      productUnitIls: 2.5,
      productTotalIls: 25000,
      airIls: 265,
      seaIls: 900,
      airLabel: "אקספרס · 1,000 יח׳",
      seaLabel: "רגיל · 9,000 יח׳",
      airQuantity: 1000,
      seaQuantity: 9000,
    };
    const want = splitCustomerView(split, 100).grandTotalIls;
    const got = customerTotalExVat({ shippingSplit: split, unitSellingPrice: 9.99, quantity: 1, moldsTotalSellingPriceIls: 100 });
    expect(got).toBe(want);
    expect(got).not.toBe(customerRoundedTotalIls(9.99, 1, 100));
  });

  it("legacy rows fall back to the stored order total, then totalSellingPrice", () => {
    expect(customerTotalExVat({ totalOrderPriceIls: 4321.5 })).toBe(4321.5);
    expect(customerTotalExVat({ totalSellingPrice: 1234 })).toBe(1234);
    expect(customerTotalExVat({ totalOrderPriceIls: 10, totalSellingPrice: 20 })).toBe(10);
    expect(customerTotalExVat({ totalOrderPriceIls: "", totalSellingPrice: "20" })).toBe(20);
  });

  it("a zero / missing quantity cannot use the unit path", () => {
    expect(customerTotalExVat({ unitSellingPrice: 1.62, quantity: 0, totalSellingPrice: 5 })).toBe(5);
    expect(customerTotalExVat({ unitSellingPrice: 1.62, totalSellingPrice: 5 })).toBe(5);
  });

  it("returns null when nothing is usable", () => {
    expect(customerTotalExVat(null)).toBeNull();
    expect(customerTotalExVat(undefined)).toBeNull();
    expect(customerTotalExVat({})).toBeNull();
    expect(customerTotalExVat({ unitSellingPrice: "x", quantity: "y" })).toBeNull();
  });
});

describe("customerRoundedTotalIls", () => {
  it("₪0.6031 × 5,000 prints as ₪0.61 × 5,000 = ₪3,050 (Eli 2026-07-07 / 2026-08-02)", () => {
    expect(customerRoundedTotalIls(0.6031, 5000)).toBe(3050);
    expect(customerRoundedTotalIls(0.6031, 5000, 100.004)).toBe(3150);
  });

  it("never rounds a per-bag price down", () => {
    expect(customerRoundedTotalIls(1.22342, 5000)).toBe(6150);
    expect(customerRoundedTotalIls(0.6899999999999999, 100)).toBe(69);
  });
});

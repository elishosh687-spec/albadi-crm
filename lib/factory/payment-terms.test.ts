import { describe, expect, it } from "vitest";
import {
  BANK_DETAILS,
  BANK_DETAILS_LINES,
  DEFAULT_PAYMENT_PLAN_ID,
  NO_PAYMENT_PLAN_ID,
  PAYMENT_PRESETS,
  VAT_PCT,
  buildPaymentBlock,
  computePaymentSchedule,
  customDepositPlan,
  resolveDealSchedule,
  resolveEffectivePlanId,
  resolvePaymentPlan,
} from "./payment-terms";

const cents = (n: number) => Math.round(n * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;

describe("constants", () => {
  it("VAT is 18% and the bank block has the five lines", () => {
    expect(VAT_PCT).toBe(18);
    expect(BANK_DETAILS_LINES).toHaveLength(5);
    expect(BANK_DETAILS_LINES[0]).toBe("פרטים להעברה בנקאית");
    expect(BANK_DETAILS.startsWith("פרטים להעברה בנקאית:\n")).toBe(true);
    expect(BANK_DETAILS.split("\n")).toHaveLength(5);
  });

  it("the three presets sum to 100 and carry one phrase per share", () => {
    expect(PAYMENT_PRESETS.map((p) => p.id)).toEqual(["50_50", "30_70", "30_40_30"]);
    for (const p of PAYMENT_PRESETS) {
      expect(p.pcts.reduce((a, b) => a + b, 0)).toBe(100);
      expect(p.whens).toHaveLength(p.pcts.length);
    }
    expect(DEFAULT_PAYMENT_PLAN_ID).toBe("50_50");
    expect(NO_PAYMENT_PLAN_ID).toBe("none");
  });
});

describe("resolveEffectivePlanId", () => {
  it.each([
    ["none", undefined, null],
    ["  none  ", { includeByDefault: true, defaultPlanId: "30_70" }, null],
    ["30_70", undefined, "30_70"],
    ["30_70", { includeByDefault: false }, "30_70"],
    [null, { includeByDefault: true, defaultPlanId: "30_70" }, "30_70"],
    [null, { includeByDefault: true }, "50_50"],
    [null, { includeByDefault: false, defaultPlanId: "30_70" }, null],
    [null, undefined, null],
    [undefined, null, null],
    ["", { includeByDefault: true, defaultPlanId: "30_40_30" }, "30_40_30"],
  ] as const)("explicit=%j cfg=%j → %j", (explicit, cfg, want) => {
    expect(resolveEffectivePlanId(explicit, cfg)).toBe(want);
  });
});

describe("resolvePaymentPlan / customDepositPlan", () => {
  it("resolves presets by id", () => {
    expect(resolvePaymentPlan("30_40_30").pcts).toEqual([30, 40, 30]);
    expect(resolvePaymentPlan(" 30_70 ").id).toBe("30_70");
  });

  it("custom_NN → a two-stage plan with that deposit", () => {
    const p = resolvePaymentPlan("custom_35");
    expect(p.id).toBe("custom_35");
    expect(p.pcts).toEqual([35, 65]);
    expect(p.label).toBe("35% / 65%");
    expect(p.whens).toHaveLength(2);
  });

  it("falls back to the default plan for unknown / empty ids", () => {
    expect(resolvePaymentPlan("what").id).toBe(DEFAULT_PAYMENT_PLAN_ID);
    expect(resolvePaymentPlan(null).id).toBe(DEFAULT_PAYMENT_PLAN_ID);
    expect(resolvePaymentPlan(undefined).id).toBe(DEFAULT_PAYMENT_PLAN_ID);
    expect(resolvePaymentPlan("custom_abc").id).toBe(DEFAULT_PAYMENT_PLAN_ID);
  });

  it("customDepositPlan clamps to 1..100 and rounds", () => {
    expect(customDepositPlan(0).pcts).toEqual([1, 99]);
    expect(customDepositPlan(150).pcts).toEqual([100, 0]);
    expect(customDepositPlan(33.6).pcts).toEqual([34, 66]);
  });
});

describe("computePaymentSchedule", () => {
  it("VAT is 18% of the ex-VAT subtotal; ₪7,900 → ₪9,322 (deal-addons, 2026-08-14)", () => {
    const s = computePaymentSchedule(7900, resolvePaymentPlan("30_40_30"));
    expect(s.subtotal).toBe(7900);
    expect(s.vat).toBe(1422);
    expect(s.total).toBe(9322);
    expect(s.installments.map((i) => i.ils)).toEqual([2796.6, 3728.8, 2796.6]);
  });

  // Eli's own example (2026-07-28): 50% of ₪21,977, not of ₪18,625.
  it("the deposit is a share of the VAT-INCLUSIVE total", () => {
    const s = computePaymentSchedule(18625, resolvePaymentPlan("50_50"));
    expect(s.total).toBe(21977.5);
    expect(s.installments[0].ils).toBe(r2(21977.5 * 0.5));
    expect(s.installments[0].ils).not.toBe(r2(18625 * 0.5));
    expect(s.installments[0].pct).toBe(50);
    expect(s.installments[0].when).toBe("מקדמה בתחילת העבודה");
    expect(s.installments[1].when).toBe("בהגיע הסחורה לישראל");
  });

  it.each([18625, 8106.33, 7900, 6793, 1234.56, 0.01, 99999.99])(
    "30/40/30 on ₪%s: first two are round2(pct × total), the last absorbs the drift, and they sum exactly",
    (exVat) => {
      const s = computePaymentSchedule(exVat, resolvePaymentPlan("30_40_30"));
      expect(s.installments).toHaveLength(3);
      expect(s.installments[0].ils).toBe(r2(s.total * 0.3));
      expect(s.installments[1].ils).toBe(r2(s.total * 0.4));
      const sum = s.installments.reduce((a, i) => a + i.ils, 0);
      expect(cents(sum)).toBe(cents(s.total));
      expect(cents(s.subtotal + s.vat)).toBe(cents(s.total));
    }
  );

  it("a custom VAT rate is honoured", () => {
    const s = computePaymentSchedule(1000, resolvePaymentPlan("50_50"), 17);
    expect(s.vat).toBe(170);
    expect(s.total).toBe(1170);
  });

  it("a plan with a single installment is the whole total", () => {
    const s = computePaymentSchedule(1000, { id: "one", label: "100%", pcts: [100], whens: ["now"] });
    expect(s.installments).toEqual([{ pct: 100, when: "now", ils: 1180 }]);
  });
});

describe("resolveDealSchedule", () => {
  it("string / null → the preset path", () => {
    expect(resolveDealSchedule(1000, "30_70")).toEqual(computePaymentSchedule(1000, resolvePaymentPlan("30_70")));
    expect(resolveDealSchedule(1000, null)).toEqual(computePaymentSchedule(1000, resolvePaymentPlan(DEFAULT_PAYMENT_PLAN_ID)));
    expect(resolveDealSchedule(1000, undefined).installments).toHaveLength(2);
  });

  // Yossi Gold (2026-07-31): a FIXED deposit already paid + the balance 50/50.
  it("honours fixed amounts, splits the remainder by pct, sums exactly", () => {
    const s = resolveDealSchedule(10000, {
      installments: [
        { ils: 3420, when: "שולם" },
        { pct: 50, when: "לפני יציאה" },
        { pct: 50, when: "בהגעה" },
      ],
    });
    expect(s.total).toBe(11800);
    expect(s.installments[0].ils).toBe(3420);
    expect(s.installments[0].pct).toBe(Math.round((3420 / 11800) * 100));
    expect(s.installments[1].ils).toBe(r2((11800 - 3420) / 2));
    const sum = s.installments.reduce((a, i) => a + i.ils, 0);
    expect(cents(sum)).toBe(cents(s.total));
  });

  it("pct shares are weights, not literal percentages", () => {
    const s = resolveDealSchedule(1000, { installments: [{ pct: 1, when: "a" }, { pct: 3, when: "b" }] });
    expect(s.installments[0].ils).toBe(295);
    expect(s.installments[1].ils).toBe(885);
  });
});

describe("buildPaymentBlock", () => {
  const s = computePaymentSchedule(7900, resolvePaymentPlan("30_40_30"));
  const block = buildPaymentBlock(s).join("\n");

  it("prints VAT, the amount due, one entry per installment and the bank lines", () => {
    expect(block).toContain("מע״מ 18%");
    expect(block).toContain("סה״כ לתשלום");
    expect(block).toContain("*תשלום ראשוני*");
    expect(block).toContain("*תשלום 2*");
    expect(block).toContain("*תשלום אחרון*");
    expect(block).toContain("(30% · מקדמה בתחילת העבודה)");
    expect(block).toContain("(40% · לפני יציאת הסחורה מהמפעל)");
    expect(block).toContain("(30% · בהגיע הסחורה לישראל)");
    for (const line of BANK_DETAILS_LINES) expect(block).toContain(line);
    expect(block).toMatch(/9[,.  ]?322[.,]00/);
  });

  it("a two-stage plan has no middle payment", () => {
    const two = buildPaymentBlock(computePaymentSchedule(1000, resolvePaymentPlan("50_50"))).join("\n");
    expect(two).toContain("*תשלום ראשוני*");
    expect(two).toContain("*תשלום אחרון*");
    expect(two).not.toContain("*תשלום 2*");
  });

  it("uses the VAT rate it is given", () => {
    expect(buildPaymentBlock(s, 17)[0]).toContain("מע״מ 17%");
  });
});

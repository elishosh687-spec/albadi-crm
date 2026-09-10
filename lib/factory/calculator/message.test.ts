import { describe, expect, it } from "vitest";
import { buildQuoteMessage, type QuoteMessageParams } from "./message";
import { customerRoundedTotalIls } from "./customer-breakdown";
import { BANK_DETAILS_LINES } from "@/lib/factory/payment-terms";

function params(overrides: Partial<QuoteMessageParams> = {}): QuoteMessageParams {
  return {
    dimensions: "H30*D10*W30",
    hasHandles: true,
    hasLamination: false,
    quantity: 5000,
    logoColors: 2,
    shippingName: "רגיל",
    shippingDays: 90,
    pricePerUnit: 0.71,
    totalOrder: 3550,
    currency: "ILS",
    appUrl: "https://albadi.co.il",
    ...overrides,
  };
}

describe("buildQuoteMessage", () => {
  it("prints the spec verbatim", () => {
    const m = buildQuoteMessage(params());
    expect(m).toContain("✅ הצעת מחיר:");
    expect(m).toContain("שקית H30*D10*W30 ס״מ");
    expect(m).toContain("ידיות: עם ידיות");
    expect(m).toContain("למינציה: ללא למינציה");
    expect(m).toMatch(/כמות: 5[,.  ]?000 \| 2 צבעי הדפסה/);
    expect(m).toContain("משלוח: רגיל (~90 ימים)");
    expect(m).toContain("המחיר לא כולל מעמ");
    expect(m).toContain("* ההצעה כפופה לאישור הסופי של החברה שלנו");
    expect(m).toContain("אלבדי – אריזה ממותגת לסביבה שלך");
    expect(m).toContain("דף הבית: https://albadi.co.il");
    expect(buildQuoteMessage(params({ hasHandles: false, hasLamination: true }))).toContain("ידיות: ללא ידיות");
    expect(buildQuoteMessage(params({ hasHandles: false, hasLamination: true }))).toContain("למינציה: עם למינציה");
  });

  it("formats prices as ₪3,550.00", () => {
    const m = buildQuoteMessage(params());
    expect(m).toContain("💰 ליחידה: ₪0.71 | סה״כ: ₪3,550.00");
    expect(m).toMatch(/₪\d{1,3}(,\d{3})*\.\d{2}/);
  });

  // Eli 2026-07-07: the printed total is ROUNDED per-unit × qty, never `totalOrder`.
  it("ignores totalOrder and prints customerRoundedTotalIls", () => {
    const m = buildQuoteMessage(params({ pricePerUnit: 0.6031, totalOrder: 3015.56 }));
    expect(customerRoundedTotalIls(0.6031, 5000)).toBe(3050);
    expect(m).toContain("ליחידה: ₪0.60 | סה״כ: ₪3,050.00");
    expect(m).not.toContain("3,015.56");
  });

  // 2026-09-06: the bot's auto-quote was the one path that never charged the plates.
  it("prints the molds line only when moldsIls > 0, and adds it to the total", () => {
    const with_ = buildQuoteMessage(params({ moldsIls: 513.89 }));
    expect(with_).toContain("🧩 תבניות / מולדים (חד פעמי): ₪513.89");
    expect(with_).toContain("סה״כ: ₪4,063.89");
    const without = buildQuoteMessage(params({ moldsIls: 0 }));
    expect(without).not.toContain("🧩 תבניות / מולדים (חד פעמי)");
    expect(buildQuoteMessage(params())).not.toContain("תבניות");
    expect(buildQuoteMessage(params({ moldsIls: -3 }))).not.toContain("תבניות");
  });

  // Eli: a cold lead must never get bank details — the bot quote has no payment block.
  it("never carries payment terms or bank details", () => {
    const m = buildQuoteMessage(params({ moldsIls: 500, alt: { shippingName: "אקספרס", shippingDays: 25, pricePerUnit: 0.9, totalOrder: 4500 } }));
    for (const line of BANK_DETAILS_LINES) expect(m).not.toContain(line);
    expect(m).not.toContain("מע״מ");
    expect(m).not.toContain("פריסת תשלומים");
    expect(m).not.toContain("סה״כ לתשלום");
    expect(m).not.toContain("תשלום ראשוני");
  });

  it("the alternative block prints its own rounded total and the saving when cheaper", () => {
    const m = buildQuoteMessage(params({ pricePerUnit: 0.9, alt: { shippingName: "רגיל", shippingDays: 90, pricePerUnit: 0.71, totalOrder: 1 } }));
    expect(m).toContain("💡 חלופה — משלוח רגיל (~90 ימים):");
    expect(m).toContain("ליחידה: ₪0.71 | סה״כ: ₪3,550.00");
    expect(m).toContain("חיסכון פוטנציאלי: ₪950.00");
  });

  it("no saving line when the alternative is dearer; molds are counted once on both", () => {
    const m = buildQuoteMessage(params({ pricePerUnit: 0.71, moldsIls: 100, alt: { shippingName: "אקספרס", shippingDays: 25, pricePerUnit: 0.9, totalOrder: 1 } }));
    expect(m).toContain("סה״כ: ₪3,650.00");
    expect(m).toContain("סה״כ: ₪4,600.00");
    expect(m).not.toContain("חיסכון פוטנציאלי");
  });

  it("showAlternative=false hides the block even when alt is passed", () => {
    const m = buildQuoteMessage(params({ showAlternative: false, alt: { shippingName: "אקספרס", shippingDays: 25, pricePerUnit: 0.9, totalOrder: 1 } }));
    expect(m).not.toContain("💡 חלופה");
    expect(buildQuoteMessage(params({ alt: null }))).not.toContain("💡 חלופה");
  });

  it("booking invitation is on by default and an empty bookingUrl removes it", () => {
    expect(buildQuoteMessage(params())).toContain("קבע שיחה קצרה – נסביר הכל ב־10 דקות\nhttps://calendly.com/elishosh687/30min");
    const m = buildQuoteMessage(params({ bookingUrl: "" }));
    expect(m).not.toContain("קבע שיחה קצרה");
    expect(m).not.toContain("calendly");
    expect(buildQuoteMessage(params({ bookingUrl: "https://x.y/z" }))).toContain("https://x.y/z");
  });

  it("priceRangePct widens the price into a range; estimateNote is appended", () => {
    const m = buildQuoteMessage(params({ pricePerUnit: 1, priceRangePct: 10, estimateNote: "* מחיר משוער" }));
    expect(m).toContain("ליחידה: ₪0.90–₪1.10 | סה״כ: ₪4,500.00–₪5,500.00");
    expect(m).toContain("* מחיר משוער\n");
    expect(buildQuoteMessage(params({ pricePerUnit: 1 }))).toContain("ליחידה: ₪1.00 | סה״כ: ₪5,000.00");
  });

  it("uses the currency symbol it is given", () => {
    expect(buildQuoteMessage(params({ currency: "USD" }))).toContain("ליחידה: $0.71");
    expect(buildQuoteMessage(params({ currency: "XYZ" }))).toContain("ליחידה: XYZ 0.71");
  });
});

/**
 * lib/leads/website-origin.ts — recognising a website lead from the sentence the
 * site prefills into WhatsApp (built 2026-08-30). The fragments ARE the whole
 * mechanism; nothing fails loudly when they stop matching.
 */
import { describe, expect, it } from "vitest";
import { detectWebsiteOrigin } from "./website-origin";

describe("detectWebsiteOrigin", () => {
  it("page CTA (he) with the interpolated page name", () => {
    const r = detectWebsiteOrigin('היי, אני בעמוד "שקיות אלבד ממותגות" באתר ואשמח להצעת מחיר לשקיות אלבד ממותגות');
    expect(r).toEqual({ kind: "page_cta", page: "שקיות אלבד ממותגות" });
  });

  it("page CTA (en), curly quotes", () => {
    const r = detectWebsiteOrigin('Hi, I am on the “Tote bags” page and would like a quote for branded non-woven bags');
    expect(r).toEqual({ kind: "page_cta", page: "Tote bags" });
  });

  it("landing page from Google", () => {
    expect(detectWebsiteOrigin("היי, הגעתי מגוגל ואשמח להצעת מחיר לשקיות אלבד ממותגות")).toEqual({
      kind: "landing_google",
      page: null,
    });
  });

  it("after the lead form", () => {
    expect(detectWebsiteOrigin("היי, הרגע השארתי פרטים באתר ואשמח להתקדם להצעת מחיר")).toEqual({
      kind: "after_lead_form",
      page: null,
    });
  });

  it("precedence follows SIGNATURES order: after_lead_form beats page_cta", () => {
    const r = detectWebsiteOrigin("הרגע השארתי פרטים באתר ואשמח להצעת מחיר");
    expect(r?.kind).toBe("after_lead_form");
  });

  it("survives customer edits around the fragment, and is case-insensitive", () => {
    expect(detectWebsiteOrigin("שלום! אני בעמוד 'קטלוג' באתר ואשמח להצעת מחיר. 3000 יח׳ בבקשה")?.page).toBe("קטלוג");
    expect(detectWebsiteOrigin("HI, I AM ON THE HOME PAGE, thanks")?.kind).toBe("page_cta");
  });

  it("page is null when there are no quotes, or the quoted run is too long", () => {
    expect(detectWebsiteOrigin("אני בעמוד הבית באתר ואשמח להצעת מחיר")?.page).toBeNull();
    const long = `"${"א".repeat(61)}" באתר ואשמח להצעת מחיר`;
    expect(detectWebsiteOrigin(long)?.page).toBeNull();
  });

  it("ordinary inbound text is not a website lead", () => {
    expect(detectWebsiteOrigin("היי, כמה עולות 1000 שקיות?")).toBeNull();
    expect(detectWebsiteOrigin("אשמח להצעת מחיר")).toBeNull(); // too generic, no fragment
    expect(detectWebsiteOrigin("")).toBeNull();
    expect(detectWebsiteOrigin("   ")).toBeNull();
    expect(detectWebsiteOrigin(null)).toBeNull();
    expect(detectWebsiteOrigin(undefined)).toBeNull();
  });
});

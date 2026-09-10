import { describe, expect, it } from "vitest";
import { validateMessage } from "./generate";
import {
  ALLOWED_SLOTS,
  THURSDAY_12,
  TOMORROW_11,
  makeSalesContext,
  makeStrategy,
} from "../../tests/fixtures/sales-context";

const ctx = makeSalesContext();
const bookCall = makeStrategy("book_call");
const answer = makeStrategy("answer_and_advance");

describe("validateMessage — shape", () => {
  it("passes a short Hebrew message with one question", () => {
    const v = validateMessage("בתאל, נשאר רק לאשר את מידת הקטלוג. נוח לך שנדבר?", ctx, answer);
    expect(v).toEqual({ ok: true, violations: [], wordCount: 10 });
  });

  it("rejects an empty message", () => {
    const v = validateMessage("   ", ctx, answer);
    expect(v.ok).toBe(false);
    expect(v.violations).toContain("הודעה ריקה");
    expect(v.wordCount).toBe(0);
  });

  it("rejects a message with no Hebrew", () => {
    const v = validateMessage("Hi, are we still on for the call?", ctx, answer);
    expect(v.violations).toContain("לא בעברית");
  });

  it("rejects more than one question", () => {
    const v = validateMessage("בתאל, קיבלת את ההצעה? מה חשבת עליה?", ctx, answer);
    expect(v.ok).toBe(false);
    expect(v.violations).toContain("2 שאלות — מותר אחת");
  });

  it("rejects a message longer than maxWords, and reports the count", () => {
    const long = Array.from({ length: 61 }, () => "שקיות").join(" ");
    const v = validateMessage(long, ctx, answer, 60);
    expect(v.wordCount).toBe(61);
    expect(v.violations).toContain("ארוכה מדי (61 מילים, מקסימום 60)");
    expect(validateMessage(long, ctx, answer, 61).ok).toBe(true);
  });

  it("rejects links — that is not this layer's job", () => {
    expect(validateMessage("בתאל, תראי את הקטלוג ב-www.albadi.co.il", ctx, answer).violations).toContain(
      "קישור בהודעה — לא בשכבה הזאת"
    );
    expect(validateMessage("בתאל, https://albadi.co.il/catalog", ctx, answer).ok).toBe(false);
  });
});

describe("validateMessage — money guard", () => {
  it("accepts the quote total we actually hold, in any rendering", () => {
    for (const text of ["בתאל, בהצעה של ₪2,610 נשאר רק לאשר את המידה.", "בתאל, ההצעה על ₪2610 עדיין בתוקף.", "₪ 2,610 זה המחיר."]) {
      const v = validateMessage(text, ctx, answer);
      expect(v.ok, text).toBe(true);
    }
  });

  it("rejects a ₪ figure we never quoted", () => {
    const v = validateMessage("בתאל, אפשר לסגור על ₪2,900 אם נסגור היום.", ctx, answer);
    expect(v.violations).toContain("מחיר שלא קיים אצלנו: ₪2,900");
  });

  it("rejects an amount that is only 'close'", () => {
    expect(validateMessage("בהצעה של ₪2,610.5 נשאר לאשר.", ctx, answer).ok).toBe(false);
  });

  // Incident 2026-08-31 (בתאל): Eli sent ₪4,470 / ₪5,800 by hand, the
  // context still carried the bot's ₪2,610 and the setter kept quoting it for
  // two days. With a superseded quote `totalIls` is null on purpose — and then
  // ANY ₪ figure is a violation, even the one that used to be right.
  it("with a superseded quote (totalIls null) any ₪ figure is a violation", () => {
    const superseded = makeSalesContext({
      quote: { totalIls: null, supersededAtIso: "2026-08-31T10:00:00.000Z" },
    });
    const v = validateMessage("בתאל, בהצעה של ₪2,610 נשאר רק לאשר את מידת הקטלוג.", superseded, answer);
    expect(v.ok).toBe(false);
    expect(v.violations).toEqual(["מחיר שלא קיים אצלנו: ₪2,610"]);
    expect(validateMessage("בתאל, לגבי ההצעה ששלחנו — נשאר רק לאשר את המידה.", superseded, answer).ok).toBe(true);
  });

  it("no quote at all → no ₪ allowed", () => {
    const noQuote = makeSalesContext({ quote: { sent: false, totalIls: null, sentAtIso: null } });
    expect(validateMessage("זה יוצא ₪2,610 ל-3,000 שקיות.", noQuote, answer).ok).toBe(false);
  });
});

describe("validateMessage — discount guard", () => {
  it.each(["הנחה", "נוריד את המחיר", "מחיר מיוחד"])("rejects '%s'", (word) => {
    const v = validateMessage(`בתאל, אם נסגור השבוע יש ${word} בשבילך.`, ctx, answer);
    expect(v.violations).toContain("מציעה הנחה — אסור");
  });
});

describe("validateMessage — hour guards", () => {
  // Incident 30/08–01/09/2026: the skill's example "היום ב-17:00 או מחר
  // ב-11:00" was copied verbatim into 20 of 26 messages, six of them offering
  // "היום ב-17:00" after 17:00 had passed.
  it("rejects an hour when the goal is not booking a call, even a legal one", () => {
    const v = validateMessage("בתאל, נדבר מחר ב-11:00?", ctx, answer, 60, ALLOWED_SLOTS);
    expect(v.violations).toEqual(["מציעה שעה למרות שהיעד אינו קביעת שיחה"]);
  });

  it("accepts an offered window, word for word", () => {
    const v = validateMessage(
      "בתאל, נשאר רק לאשר את מידת הקטלוג ולהציץ בלוגו. אפשר שיחה קצרה מחר ב-11:00?",
      ctx,
      bookCall,
      60,
      ALLOWED_SLOTS
    );
    expect(v).toEqual({ ok: true, violations: [], wordCount: 14 });
  });

  it("accepts both windows in one message", () => {
    const v = validateMessage(
      `בתאל, נשאר רק לאשר את המידה. מתאים לך ${TOMORROW_11.label} או ${THURSDAY_12.label}?`,
      ctx,
      bookCall,
      60,
      ALLOWED_SLOTS
    );
    expect(v.ok).toBe(true);
  });

  it("normalises the maqaf (ב־11:00) before comparing", () => {
    const v = validateMessage("בתאל, נשאר רק לאשר את המידה. מתאים לך מחר ב־11:00?", ctx, bookCall, 60, ALLOWED_SLOTS);
    expect(v.ok).toBe(true);
  });

  // Latent inconsistency: the hour guard pads "9:00" to "09:00" before
  // matching, but the day guard checks the raw slot time ("09:00") against the
  // message text, so a single-digit hour trips "היום לא תואם לשעה" even though
  // the hour itself was accepted. Unreachable today — HOUR_POOL starts at 10 —
  // but the two guards should normalise the same way. Kept as the correct
  // expectation.
  it.fails("accepts the 4-character form (9:00 vs 09:00) of an offered hour", () => {
    const slot = { label: "מחר ב-09:00", time: "09:00", iso: "2026-09-02T06:00:00.000Z" };
    expect(validateMessage("מתאים לך מחר ב-9:00?", ctx, bookCall, 60, [slot]).ok).toBe(true);
  });

  it("rejects 'היום ב-17:00' when the only windows are tomorrow and Thursday", () => {
    const v = validateMessage(
      "בתאל, נשאר רק לאשר את מידת הקטלוג ולהציץ בלוגו. אפשר שיחה של 10 דקות היום ב-17:00?",
      ctx,
      bookCall,
      60,
      ALLOWED_SLOTS
    );
    expect(v.ok).toBe(false);
    expect(v.violations).toEqual(["שעה שלא הוצעה לה: 17:00 (מותר רק: 11:00, 12:00)"]);
  });

  it("rejects a legal hour on the wrong day ('היום ב-11:00' when the slot is 'מחר ב-11:00')", () => {
    const v = validateMessage("בתאל, מתאים לך היום ב-11:00?", ctx, bookCall, 60, [TOMORROW_11]);
    expect(v.ok).toBe(false);
    expect(v.violations).toEqual(["היום לא תואם לשעה — מותר רק: מחר ב-11:00"]);
  });

  it("with no windows at all, no hour may be named", () => {
    const v = validateMessage("בתאל, מתאים לך מחר ב-11:00?", ctx, bookCall, 60, []);
    expect(v.violations).toEqual(["שעה שלא הוצעה לה: 11:00 (מותר רק: אין)"]);
  });

  it("a booking message without any hour is fine", () => {
    const v = validateMessage("בתאל, מתי נוח לך לשיחה קצרה השבוע?", ctx, bookCall, 60, ALLOWED_SLOTS);
    expect(v.ok).toBe(true);
  });

  it("'revive' may name a window just like 'book_call'", () => {
    const v = validateMessage("בתאל, נחזור לזה? מתאים לך מחר ב-11:00", ctx, makeStrategy("revive"), 60, ALLOWED_SLOTS);
    expect(v.ok).toBe(true);
  });

  it("reports every violation at once", () => {
    const v = validateMessage(
      "בתאל, יש הנחה של ₪500 אם נדבר היום ב-17:00? או מחר? www.albadi.co.il",
      ctx,
      bookCall,
      60,
      ALLOWED_SLOTS
    );
    expect(v.ok).toBe(false);
    expect(v.violations).toEqual([
      "2 שאלות — מותר אחת",
      "מחיר שלא קיים אצלנו: ₪500",
      "מציעה הנחה — אסור",
      "שעה שלא הוצעה לה: 17:00 (מותר רק: 11:00, 12:00)",
      "קישור בהודעה — לא בשכבה הזאת",
    ]);
  });
});

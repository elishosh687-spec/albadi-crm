import { describe, expect, it } from "vitest";
import { assessFunnelHealth } from "./health";

describe("assessFunnelHealth", () => {
  it("is healthy only when every source-to-event gap is zero", () => {
    expect(assessFunnelHealth({ questionnaireStarts: 0, questionnaireAnswers: 0, quotes: 0, quoteReplies: 0 })).toEqual({
      healthy: true,
      totalGaps: 0,
      lines: [],
    });
  });

  it("returns actionable Hebrew lines without customer identifiers", () => {
    const result = assessFunnelHealth({ questionnaireStarts: 2, questionnaireAnswers: 3, quotes: 1, quoteReplies: 4 });
    expect(result.healthy).toBe(false);
    expect(result.totalGaps).toBe(10);
    expect(result.lines).toEqual([
      "2 שאלונים ללא אירוע פתיחה",
      "3 תשובות ללא אירוע שלב",
      "1 הצעות מחיר ללא אירוע שליחה",
      "4 תגובות למחיר ללא אירוע תגובה",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeTranscriptText, validateEvidence } from "./evidence";

describe("call evidence grounding", () => {
  it("accepts a quote after harmless whitespace and quote normalization", () => {
    const transcript = "לקוח:  אני צריך\nאת השקיות עד יום חמישי";
    const evidence = validateEvidence("אני צריך את השקיות עד יום חמישי", transcript);
    expect(evidence.validation).toBe("valid");
    expect(evidence.start).not.toBeNull();
  });

  it("rejects a fabricated quote", () => {
    expect(validateEvidence("אני סוגר היום", "אני רק בודק מחיר").validation).toBe("not_found");
  });

  it("marks an absent quote as missing", () => {
    expect(validateEvidence(null, "תמלול").validation).toBe("missing");
  });

  it("removes direction marks and normalizes whitespace", () => {
    expect(normalizeTranscriptText(" א\u200f   ב\nג ")).toBe("א ב ג");
  });
});

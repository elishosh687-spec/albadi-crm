import { describe, expect, it } from "vitest";
import { normalizeCallAnalysisV2 } from "./analysis-normalize";

const anchor = new Date("2026-09-17T09:00:00.000Z");

describe("normalizeCallAnalysisV2", () => {
  it("keeps unknown values unknown and normalizes malformed collections", () => {
    const result = normalizeCallAnalysisV2(
      { sentiment: "excited", specification: { approved: "yes" }, customer_needs: null },
      { transcript: "לקוח אומר שהוא רק בודק אפשרויות כרגע", callStartedAt: anchor },
    );
    expect(result.sentiment).toBe("neutral");
    expect(result.specification.approved).toBeNull();
    expect(result.customer_needs).toEqual([]);
    expect(result.customer.whyNow).toBeNull();
  });

  it("blocks action eligibility for voicemail and short transcripts", () => {
    const result = normalizeCallAnalysisV2(
      { isVoicemail: true, outcome: { proposedAction: { description: "לחזור", actionType: "callback" } } },
      { transcript: "היי", callStartedAt: anchor, minTranscriptChars: 20 },
    );
    expect(result.isVoicemail).toBe(true);
    expect(result.isTooShortForAction).toBe(true);
  });

  it("rejects implausibly distant dates and ungrounded evidence", () => {
    const result = normalizeCallAnalysisV2(
      {
        outcome: {
          proposedAction: {
            actionType: "callback",
            description: "לחזור ללקוח",
            responsibleParty: "salesperson",
            dueAt: "2028-01-01T10:00:00+03:00",
            confidence: 95,
            evidence: { quote: "תחזור אליי מחר" },
          },
        },
      },
      {
        transcript: "הלקוח ביקש רק לקבל מידע כללי על שקיות ממותגות לעסק שלו",
        callStartedAt: anchor,
      },
    );
    expect(result.outcome.proposedAction?.dueAt).toBeNull();
    expect(result.outcome.proposedAction?.confidence).toBe(0.95);
    expect(result.outcome.proposedAction?.evidence.validation).toBe("not_found");
  });

  it("produces a stable input hash", () => {
    const one = normalizeCallAnalysisV2({}, { transcript: "א   ב", callStartedAt: anchor });
    const two = normalizeCallAnalysisV2({}, { transcript: "א\nב", callStartedAt: anchor });
    expect(one.metadata.inputHash).toBe(two.metadata.inputHash);
  });
});

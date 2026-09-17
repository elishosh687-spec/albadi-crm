import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_SETTINGS } from "../bot-settings/schema";
import { normalizeCallAnalysisV2 } from "./analysis-normalize";
import { evaluateStatusRecommendation, isExplicitLostEvidence } from "./status-policy";

const transcript = "לקוח: כבר סגרתי עם ספק אחר, תודה ואל תחזרו אליי";
const analysis = normalizeCallAnalysisV2(
  {
    outcome: {
      statusRecommendation: {
        status: "lost",
        reason: "בחר ספק אחר",
        confidence: 0.99,
        evidence: { quote: "כבר סגרתי עם ספק אחר" },
      },
    },
  },
  { transcript, callStartedAt: new Date("2026-09-17T09:00:00Z") },
);

describe("evaluateStatusRecommendation", () => {
  it("recognizes only grounded explicit loss wording", () => {
    expect(isExplicitLostEvidence(analysis)).toBe(true);
  });
  it("keeps LOST recommendation-only even if a setting says automatic", () => {
    const result = evaluateStatusRecommendation({
      analysis,
      settings: { ...DEFAULT_BOT_SETTINGS, callAnalysisLostStatusMode: "automatic" },
      explicitLostSignal: true,
    });
    expect(result).toMatchObject({ decision: "recommend", reason: "sensitive_status_launch_guard" });
  });

  it("blocks a non-response LOST recommendation without cumulative history", () => {
    const result = evaluateStatusRecommendation({
      analysis,
      settings: DEFAULT_BOT_SETTINGS,
      noResponseCallCount: 1,
      noResponseWhatsappCount: 2,
      explicitLostSignal: false,
    });
    expect(result?.decision).toBe("blocked");
  });
});

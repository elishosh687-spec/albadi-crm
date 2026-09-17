import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_SETTINGS, normalizeBotSettings } from "./schema";

describe("bot settings handoff defaults", () => {
  it("upgrades the old quote CTA but preserves a custom CTA", () => {
    expect(
      normalizeBotSettings({
        decisionPrompt:
          "מה דעתכם על ההצעה?\n\n✅ מתאים → שלחו לנו את הלוגו ונמשיך.\n🔧 רוצים לשנות משהו?",
      }).decisionPrompt
    ).toBe(DEFAULT_BOT_SETTINGS.decisionPrompt);
    expect(normalizeBotSettings({ decisionPrompt: "טקסט מותאם" }).decisionPrompt).toBe(
      "טקסט מותאם"
    );
  });

  it("adds call-analysis settings with safe execution defaults", () => {
    const settings = normalizeBotSettings({});
    expect(settings.callAnalysisEnabled).toBe(true);
    expect(settings.callAnalysisTaskMode).toBe("shadow");
    expect(settings.callAnalysisWonStatusMode).toBe("recommend");
    expect(settings.callAnalysisLostStatusMode).toBe("recommend");
    expect(settings.callAnalysisEvidenceRequired).toBe(true);
  });

  it("clamps call-analysis numbers and rejects wrong value types", () => {
    const settings = normalizeBotSettings({
      callAnalysisConfidenceThreshold: 1000,
      callAnalysisMaxFutureDays: -20,
      callAnalysisEnabled: "yes",
    });
    expect(settings.callAnalysisConfidenceThreshold).toBe(100);
    expect(settings.callAnalysisMaxFutureDays).toBe(7);
    expect(settings.callAnalysisEnabled).toBe(true);
  });
});

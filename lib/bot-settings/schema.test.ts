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
});

import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_SETTINGS } from "../bot-settings/schema";
import { normalizeCallAnalysisV2 } from "./analysis-normalize";
import { buildCallAnalysisNote } from "./note-builder";

const transcript = "לקוח: תחזור אליי מחר בעשר בבקשה כי אני רוצה להתקדם";
const analysis = normalizeCallAnalysisV2(
  { call_summary: "הלקוח ביקש חזרה", outcome: { result: "נקבעה חזרה" } },
  { transcript, callStartedAt: new Date("2026-09-17T09:00:00Z") },
);

describe("buildCallAnalysisNote", () => {
  it("omits the transcript and unselected sections through settings", () => {
    const note = buildCallAnalysisNote({
      marker: "[TEST]",
      sourceLabel: "שיחה",
      startedAt: null,
      durationSec: null,
      analysis,
      transcript,
      settings: {
        ...DEFAULT_BOT_SETTINGS,
        callAnalysisIncludeTranscript: false,
        callAnalysisNoteSections: "summary,outcome",
      },
    });
    expect(note).toContain("הלקוח ביקש חזרה");
    expect(note).not.toContain("📄 תמלול");
    expect(note).not.toContain("🎯 צרכים");
  });
});

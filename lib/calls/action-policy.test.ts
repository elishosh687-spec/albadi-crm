import { describe, expect, it } from "vitest";
import { DEFAULT_BOT_SETTINGS } from "../bot-settings/schema";
import { normalizeCallAnalysisV2 } from "./analysis-normalize";
import { evaluateCallAction } from "./action-policy";

const startedAt = new Date("2026-09-17T09:00:00.000Z");
const transcript = "לקוח: תחזור אליי מחר בעשר בבקשה, ואז נוכל להתקדם עם ההזמנה";

function analysis(patch: Record<string, unknown> = {}) {
  return normalizeCallAnalysisV2(
    {
      outcome: {
        proposedAction: {
          actionType: "callback",
          description: "לחזור ללקוח",
          responsibleParty: "salesperson",
          dueAt: "2026-09-18T07:00:00.000Z",
          confidence: 0.94,
          evidence: { quote: "תחזור אליי מחר בעשר בבקשה" },
          ...patch,
        },
      },
    },
    { transcript, callStartedAt: startedAt, minTranscriptChars: 20 },
  );
}

describe("evaluateCallAction", () => {
  it("auto-creates only after every gate passes in hybrid mode", () => {
    const result = evaluateCallAction({
      analysis: analysis(),
      settings: { ...DEFAULT_BOT_SETTINGS, callAnalysisTaskMode: "hybrid" },
      callStartedAt: startedAt,
      assigneeResolved: true,
    });
    expect(result.decision).toBe("auto_create");
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  });

  it("keeps a safe action in shadow mode without executing it", () => {
    const result = evaluateCallAction({
      analysis: analysis(),
      settings: DEFAULT_BOT_SETTINGS,
      callStartedAt: startedAt,
      assigneeResolved: true,
    });
    expect(result).toMatchObject({ decision: "needs_approval", reason: "shadow_mode" });
  });

  it("requires approval for a missing owner or ungrounded evidence", () => {
    const missingOwner = evaluateCallAction({
      analysis: analysis(),
      settings: { ...DEFAULT_BOT_SETTINGS, callAnalysisTaskMode: "hybrid" },
      callStartedAt: startedAt,
      assigneeResolved: false,
    });
    expect(missingOwner.reason).toBe("owner_missing");

    const ungrounded = evaluateCallAction({
      analysis: analysis({ evidence: { quote: "ציטוט שלא היה בשיחה" } }),
      settings: { ...DEFAULT_BOT_SETTINGS, callAnalysisTaskMode: "hybrid" },
      callStartedAt: startedAt,
      assigneeResolved: true,
    });
    expect(ungrounded.reason).toBe("evidence_missing");
  });

  it("turns a customer promise into a salesperson follow-up", () => {
    const result = evaluateCallAction({
      analysis: analysis({
        actionType: "other",
        description: "לשלוח את הלוגו",
        responsibleParty: "customer",
      }),
      settings: { ...DEFAULT_BOT_SETTINGS, callAnalysisTaskMode: "hybrid" },
      callStartedAt: startedAt,
      assigneeResolved: true,
    });
    expect(result.action).toMatchObject({
      actionType: "check_logo_received",
      responsibleParty: "salesperson",
    });
  });

  it("does not create an exact duplicate", () => {
    const result = evaluateCallAction({
      analysis: analysis(),
      settings: { ...DEFAULT_BOT_SETTINGS, callAnalysisTaskMode: "hybrid" },
      callStartedAt: startedAt,
      assigneeResolved: true,
      conflict: "duplicate",
    });
    expect(result).toMatchObject({ decision: "no_action", reason: "duplicate" });
  });

  it("fails closed for an unknown task mode", () => {
    const result = evaluateCallAction({
      analysis: analysis(),
      settings: { ...DEFAULT_BOT_SETTINGS, callAnalysisTaskMode: "unexpected" },
      callStartedAt: startedAt,
      assigneeResolved: true,
    });
    expect(result.decision).toBe("needs_approval");
  });

  it("automatic mode does not require the hybrid allow-list", () => {
    const result = evaluateCallAction({
      analysis: analysis({ actionType: "send_sample" }),
      settings: {
        ...DEFAULT_BOT_SETTINGS,
        callAnalysisTaskMode: "automatic",
        callAnalysisAutoActionTypes: "callback",
      },
      callStartedAt: startedAt,
      assigneeResolved: true,
    });
    expect(result.decision).toBe("auto_create");
  });
});

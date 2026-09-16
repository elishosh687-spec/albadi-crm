import { describe, expect, it } from "vitest";
import { buildFunnelEventIdentity } from "./funnel-event-identity";

describe("buildFunnelEventIdentity", () => {
  it("creates the same key for retries in one attempt", () => {
    const first = buildFunnelEventIdentity({
      leadSid: " 972500000000 ",
      event: "quote_sent",
      explicitAttemptId: "attempt-a",
    });
    const retry = buildFunnelEventIdentity({
      leadSid: "972500000000",
      event: "quote_sent",
      explicitAttemptId: "attempt-a",
    });

    expect(first).toEqual(retry);
    expect(first.eventKey).toBe("attempt-a:quote_sent");
  });

  it("keeps a genuine restart as a separate attempt", () => {
    const first = buildFunnelEventIdentity({
      leadSid: "972500000000",
      event: "questionnaire_started",
      explicitAttemptId: "attempt-a",
    });
    const restart = buildFunnelEventIdentity({
      leadSid: "972500000000",
      event: "questionnaire_started",
      explicitAttemptId: "attempt-b",
    });

    expect(first.eventKey).not.toBe(restart.eventKey);
  });

  it("uses the persisted questionnaire attempt before the legacy fallback", () => {
    expect(
      buildFunnelEventIdentity({
        leadSid: "972500000000",
        event: "size_selected",
        stateAttemptId: "state-attempt",
      }).attemptId
    ).toBe("state-attempt");
  });

  it("allows repeatable events to supply their own unique key", () => {
    expect(
      buildFunnelEventIdentity({
        leadSid: "972500000000",
        event: "followup_sent",
        explicitAttemptId: "attempt-a",
        explicitEventKey: "attempt-a:followup:template-2:3",
      }).eventKey
    ).toBe("attempt-a:followup:template-2:3");
  });
});

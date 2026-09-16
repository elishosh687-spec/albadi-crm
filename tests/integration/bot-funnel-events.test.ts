import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordBotFunnelEvent } from "@/lib/autoresponder/funnel-events";
import { ciSid, sql } from "./_db";

const SID = ciSid("funnel-events");

async function cleanup(): Promise<void> {
  await sql(`DELETE FROM bot_funnel_events WHERE lead_sid = $1`, [SID]);
  await sql(`DELETE FROM leads WHERE manychat_sub_id = $1`, [SID]);
}

beforeAll(async () => {
  await cleanup();
  await sql(
    `INSERT INTO leads (manychat_sub_id, active, q_state, meta_ad_id, meta_campaign_id)
     VALUES ($1, true, $2::jsonb, 'ci-ad', 'ci-campaign')`,
    [SID, JSON.stringify({ attemptId: "attempt-a", step: 1 })]
  );
});

afterAll(cleanup);

describe("recordBotFunnelEvent", () => {
  it("dedupes a retry within one attempt", async () => {
    await recordBotFunnelEvent({ leadSid: SID, event: "questionnaire_started" });
    await recordBotFunnelEvent({ leadSid: SID, event: "questionnaire_started" });

    const rows = await sql(
      `SELECT attempt_id, event_key, ad_id, campaign_id
       FROM bot_funnel_events WHERE lead_sid = $1`,
      [SID]
    );
    expect(rows).toEqual([
      {
        attempt_id: "attempt-a",
        event_key: "attempt-a:questionnaire_started",
        ad_id: "ci-ad",
        campaign_id: "ci-campaign",
      },
    ]);
  });

  it("records a questionnaire restart as a second genuine attempt", async () => {
    await recordBotFunnelEvent({
      leadSid: SID,
      event: "questionnaire_started",
      attemptId: "attempt-b",
    });

    const rows = await sql(
      `SELECT count(*)::int count, count(distinct attempt_id)::int attempts
       FROM bot_funnel_events
       WHERE lead_sid = $1 AND event = 'questionnaire_started'`,
      [SID]
    );
    expect(rows).toEqual([{ count: 2, attempts: 2 }]);
  });

  it("keeps repeatable follow-ups when each one has a distinct event key", async () => {
    await recordBotFunnelEvent({
      leadSid: SID,
      event: "followup_sent",
      attemptId: "attempt-b",
      eventKey: "attempt-b:followup:1",
    });
    await recordBotFunnelEvent({
      leadSid: SID,
      event: "followup_sent",
      attemptId: "attempt-b",
      eventKey: "attempt-b:followup:2",
    });

    const rows = await sql(
      `SELECT count(*)::int count FROM bot_funnel_events
       WHERE lead_sid = $1 AND event = 'followup_sent'`,
      [SID]
    );
    expect(rows).toEqual([{ count: 2 }]);
  });
});

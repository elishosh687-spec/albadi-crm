import { describe, expect, it } from "vitest";
import { RETRY_WINDOW_DAYS, selectPurchaseRetries, type RetryCandidateInput } from "./purchase-retry";

const NOW = Date.parse("2026-09-18T20:00:00Z");
const row = (over: Partial<RetryCandidateInput> = {}): RetryCandidateInput => ({
  dealId: "fq_1",
  leadSid: "972500000000@c.us",
  customerName: "סהר צור",
  valueExVat: 5000,
  sentAt: null,
  error: "Error connecting to database: fetch failed",
  closedAt: "2026-09-16T20:37:28Z",
  hasAttributionKey: true,
  ...over,
});

describe("selectPurchaseRetries", () => {
  it("regression 16/09: a Purchase that failed on a transient DB error is retried", () => {
    const [c] = selectPurchaseRetries([row()], NOW);
    expect(c).toMatchObject({ dealId: "fq_1", name: "סהר צור", value: 5000 });
    expect(c.eventTime).toBe(Math.floor(Date.parse("2026-09-16T20:37:28Z") / 1000));
  });

  it.each([
    ["already sent", { sentAt: "2026-09-17T00:00:00Z" }],
    ["no attribution key — Meta would refuse it every day", { hasAttributionKey: false }],
    ["no value — value-less Purchases are refused", { valueExVat: 0 }],
    ["no lead", { leadSid: " " }],
    ["closed outside the retry window", { closedAt: new Date(NOW - (RETRY_WINDOW_DAYS + 1) * 86_400_000).toISOString() }],
    ["no close date", { closedAt: null }],
  ] as const)("skips: %s", (_why, over) => {
    expect(selectPurchaseRetries([row(over as Partial<RetryCandidateInput>)], NOW)).toEqual([]);
  });

  it("regression 03/09 (Elran): a deal never stamped at all — sent nor failed — is retried", () => {
    const [c] = selectPurchaseRetries([row({ error: null })], NOW);
    expect(c).toMatchObject({ dealId: "fq_1", previousError: "never stamped" });
  });

  it("clamps event_time into Meta's 7-day window", () => {
    const [c] = selectPurchaseRetries([row({ closedAt: "2026-09-01T00:00:00Z" })], NOW);
    expect(Math.floor(NOW / 1000) - c.eventTime).toBe(6 * 24 * 60 * 60);
  });
});

/**
 * lib/google/conversions.ts + conversions-upload.ts — which lead owes Google
 * which offline conversion, and the Data Manager request (2026-09-23).
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { hashedIdentifiers, ingestBody, israelTimestamp, pendingConversions, type ConvLead } from "./conversions";
import { conversionsMode, explainDataManagerError, ingestEvents } from "./conversions-upload";
import { _resetTokenCache, type FetchFn } from "./ads-client";

const V = { qualifiedValueIls: 100, quoteValueIls: 300, actions: { qualified: "7711834479", quote: "7711834482", purchase: "7711834485" } };
const NOW = new Date("2026-10-10T12:00:00Z");
const lead = (p: Partial<ConvLead> = {}): ConvLead => ({
  sid: "972500000001@s.whatsapp.net", gclid: "CjwKCAjw-click", gbraid: null, wbraid: null,
  clickAt: new Date("2026-10-01T09:00:00Z"), stage: null, suitable: false, suitableAt: null,
  email: " Dana@Example.com ", phoneE164: "972501234567",
  qualifiedSentAt: null, quoteSentAt: null, purchaseSentAt: null, deals: [], ...p,
});
const events = (l: ConvLead) => pendingConversions(l, V, NOW).map((c) => c.event);

describe("pendingConversions", () => {
  it("a new lead with no progress owes nothing", () => {
    expect(events(lead())).toEqual([]);
  });

  it("the suitable tag → qualified, at the time the tag was set, value from settings", () => {
    const [c] = pendingConversions(lead({ suitable: true, suitableAt: new Date("2026-10-03T10:00:00Z") }), V, NOW);
    expect(c).toMatchObject({ event: "qualified", actionId: "7711834479", valueIls: 100, transactionId: "albadi-qualified-972500000001@s.whatsapp.net" });
    expect(c.at.toISOString()).toBe("2026-10-03T10:00:00.000Z");
  });

  it("stage DISCAVERY → qualified; CONSIDERATION → qualified + quote (like Meta)", () => {
    expect(events(lead({ stage: "DISCAVERY" }))).toEqual(["qualified"]);
    expect(events(lead({ stage: "CONSIDERATION" }))).toEqual(["qualified", "quote"]);
  });

  it("a closed deal → all three; purchase carries the real total and the close time", () => {
    const l = lead({ deals: [{ closedAt: new Date("2026-10-08T08:00:00Z"), valueIls: 8000 }, { closedAt: new Date("2026-10-09T08:00:00Z"), valueIls: 1500.5 }] });
    const cs = pendingConversions(l, V, NOW);
    expect(cs.map((c) => c.event)).toEqual(["qualified", "quote", "purchase"]);
    const p = cs.find((c) => c.event === "purchase")!;
    expect(p.valueIls).toBe(9500.5);
    expect(p.at.toISOString()).toBe("2026-10-08T08:00:00.000Z");
  });

  it("what was already sent is never sent again", () => {
    const d = new Date("2026-10-05T00:00:00Z");
    expect(events(lead({ stage: "WON", deals: [{ closedAt: d, valueIls: 100 }], qualifiedSentAt: d, quoteSentAt: d }))).toEqual(["purchase"]);
  });

  it("no click id, or a click older than 90 days → nothing", () => {
    expect(events(lead({ gclid: null, stage: "WON" }))).toEqual([]);
    expect(events(lead({ stage: "WON", clickAt: new Date("2026-06-01T00:00:00Z") }))).toEqual([]);
  });

  it("a conversion is never dated before its click", () => {
    const [c] = pendingConversions(lead({ suitable: true, suitableAt: new Date("2026-09-01T00:00:00Z") }), V, NOW);
    expect(c.at.getTime()).toBeGreaterThan(new Date("2026-10-01T09:00:00Z").getTime());
  });

  it("a deal of ₪0 is not reported as a purchase", () => {
    expect(events(lead({ deals: [{ closedAt: NOW, valueIls: 0 }] }))).toEqual(["qualified", "quote"]);
  });
});

describe("request body", () => {
  it("hashes email lowercased/trimmed and phone as E.164", () => {
    const ids = hashedIdentifiers(" Dana@Example.com ", "972501234567");
    expect(ids[0].emailAddress).toBe(createHash("sha256").update("dana@example.com").digest("hex"));
    expect(ids[1].phoneNumber).toBe(createHash("sha256").update("+972501234567").digest("hex"));
  });

  it("Israel timestamp with its offset", () => {
    expect(israelTimestamp(new Date("2026-08-31T22:30:00Z"))).toBe("2026-09-01T01:30:00+03:00");
    expect(israelTimestamp(new Date("2026-12-01T10:00:00Z"))).toBe("2026-12-01T12:00:00+02:00");
  });

  it("one destination per action, gclid as ad identifier, validateOnly carried", () => {
    const l = lead({ stage: "DISCAVERY" });
    const [conv] = pendingConversions(l, V, NOW);
    const b = ingestBody("6763920913", conv.actionId, [{ conv, lead: l }], true);
    expect(b.destinations).toEqual([{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: "6763920913" }, productDestinationId: "7711834479" }]);
    expect(b.validateOnly).toBe(true);
    expect(b.encoding).toBe("HEX");
    expect(b.events[0]).toMatchObject({ transactionId: conv.transactionId, conversionValue: 100, currency: "ILS", eventSource: "OTHER", adIdentifiers: { gclid: "CjwKCAjw-click" } });
    expect(b.events[0].userData?.userIdentifiers).toHaveLength(2);
  });

  it("an iOS lead without gclid uses gbraid", () => {
    const l = lead({ gclid: null, gbraid: "0AAAAAgbraid", stage: "DISCAVERY" });
    const [conv] = pendingConversions(l, V, NOW);
    expect(ingestBody("1", conv.actionId, [{ conv, lead: l }], true).events[0].adIdentifiers).toEqual({ gbraid: "0AAAAAgbraid" });
  });
});

describe("upload", () => {
  beforeEach(() => _resetTokenCache());
  const env = { GOOGLE_ADS_CLIENT_ID: "c", GOOGLE_ADS_CLIENT_SECRET: "s", GOOGLE_DATAMANAGER_REFRESH_TOKEN: "dm-refresh" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("mode defaults to validate; only off/live are accepted besides", () => {
    expect(conversionsMode({})).toBe("validate");
    expect(conversionsMode({ GOOGLE_CONVERSIONS_MODE: "LIVE" })).toBe("live");
    expect(conversionsMode({ GOOGLE_CONVERSIONS_MODE: "yes" })).toBe("validate");
  });

  it("no Data Manager token → not configured, no network", async () => {
    let calls = 0;
    const fn: FetchFn = async () => { calls++; return json(200, {}); };
    const r = await ingestEvents({}, { fetchFn: fn, env: { GOOGLE_ADS_CLIENT_ID: "c", GOOGLE_ADS_CLIENT_SECRET: "s" } });
    expect(r).toMatchObject({ ok: false, configured: false });
    expect(calls).toBe(0);
  });

  it("posts to events:ingest with the Data Manager token and returns the request id", async () => {
    const seen: string[] = [];
    const fn: FetchFn = async (url) => {
      seen.push(url);
      return url.includes("oauth2") ? json(200, { access_token: "DM", expires_in: 3600 }) : json(200, { requestId: "req-1" });
    };
    const r = await ingestEvents({ events: [] }, { fetchFn: fn, env });
    expect(r).toEqual({ ok: true, requestId: "req-1", warnings: [] });
    expect(seen[1]).toBe("https://datamanager.googleapis.com/v1/events:ingest");
  });

  it("explains a token without the datamanager scope and a disabled API", () => {
    expect(explainDataManagerError(403, { error: { message: "Request had insufficient authentication scopes.", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } })).toContain("scope");
    expect(explainDataManagerError(403, { error: { message: "Data Manager API has not been used in project 1 before or it is disabled", details: [{ reason: "SERVICE_DISABLED" }] } })).toContain("לא מופעל");
  });
});

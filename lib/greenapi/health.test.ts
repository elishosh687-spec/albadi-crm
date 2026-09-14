/**
 * lib/greenapi/health.ts — "is WhatsApp still reaching us?"
 *
 * The alert this module raises is the one that has to be believed: it exists
 * because inbound died on 06/09 at 22:31 and cost a full working day. So the
 * tests here are mostly about NOT crying wolf.
 *
 * `assessGreenHealth` talks to the DB and to Green API, so both are faked:
 * `vi.mock("@/lib/db")` replaces the unit-setup Proxy (which throws on any
 * access) with a recording `execute`, and `fetch` is stubbed per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ⚠️ The Green credentials must exist BEFORE the import: lib/greenapi/client
// reads them into module constants at import time, so a vi.stubEnv in
// beforeEach lands too late and greenConfigured() answers false — which makes
// every assertion here fail with "GreenAPI לא מוגדר" instead of the rule under
// test. vi.hoisted runs before the imports; that is the point of it.
const { execute } = vi.hoisted(() => {
  process.env.GREEN_API_ID_INSTANCE = "1";
  process.env.GREEN_API_API_TOKEN_INSTANCE = "t";
  process.env.GREEN_API_API_URL = "https://green.test";
  return { execute: vi.fn<(q: unknown) => Promise<{ rows: unknown[] }>>() };
});
vi.mock("@/lib/db", () => ({ db: { execute } }));
vi.mock("@/lib/clock/hebcal", () => ({ isNoSendDay: async () => false }));

import { assessGreenHealth } from "./health";

/** Flatten a drizzle SQL object into its text so a query can be recognised. */
function flatten(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk && typeof chunk === "object") {
    const c = chunk as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(c.queryChunks)) return c.queryChunks.map(flatten).join("");
    if (Array.isArray(c.value)) return c.value.join("");
    if ("value" in c) return flatten(c.value);
  }
  return String(chunk);
}

/** A Tuesday, 14:00 Israel — inside the working window, so the rule is armed. */
const NOW = new Date("2026-09-15T11:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/** Wire the two queries assessGreenHealth makes. */
function db(opts: { lastCustomerMessage: string | null; outbound: number; webhooks: Record<string, string> }) {
  execute.mockImplementation(async (q: unknown) => {
    const text = flatten(q);
    if (text.includes("FROM messages")) {
      return { rows: [{ last_inbound: opts.lastCustomerMessage, outbound_in_window: opts.outbound }] };
    }
    if (text.includes("FROM bridge_events")) {
      return { rows: Object.entries(opts.webhooks).map(([type, newest]) => ({ type: `green.${type}`, newest })) };
    }
    return { rows: [] };
  });
}

const GREEN_OK = { stateInstance: "authorized", incomingWebhook: "yes", outgoingMessageWebhook: "yes" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(GREEN_OK), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  execute.mockReset();
});

describe("assessGreenHealth — inbound liveness", () => {
  it("a colleague's message keeps it healthy, though it creates no messages row (regression, 2026-09-14)", async () => {
    // THE INCIDENT: Simon and the Eco Brothers partner wrote between 01:19 and
    // 02:00. Both are registered team members, so the webhook returns early by
    // design (the 30/08 fix) and no `messages` row exists. This check counted
    // rows, saw six silent hours, and told Eli the inbound had "probably died
    // again, just like 7.9" — while five webhooks had landed and been handled.
    db({
      lastCustomerMessage: hoursAgo(72), // no CUSTOMER since the holiday
      outbound: 3,
      webhooks: { incomingMessageReceived: hoursAgo(1), outgoingAPIMessageReceived: hoursAgo(0.1) },
    });
    const h = await assessGreenHealth({ now: NOW });
    expect(h.ok).toBe(true);
    expect(h.reason).toBeNull();
    expect(h.inboundSilentHours).toBeCloseTo(1, 1); // the webhook, not the 72h row
    expect(h.lastCustomerMessageAt).toBe(hoursAgo(72)); // still reported, for the human
  });

  it("still fires when NOTHING has arrived — webhook or message — while we are sending", async () => {
    // The 06/09 signature itself: we speak, nothing comes back, by any route.
    db({
      lastCustomerMessage: hoursAgo(9),
      outbound: 4,
      webhooks: { incomingMessageReceived: hoursAgo(9), outgoingAPIMessageReceived: hoursAgo(0.1) },
    });
    const h = await assessGreenHealth({ now: NOW });
    expect(h.ok).toBe(false);
    expect(h.reason).toContain("הקליטה כנראה מתה");
  });

  it("a quiet stretch with nothing going out is not a fault", async () => {
    db({ lastCustomerMessage: hoursAgo(9), outbound: 0, webhooks: { incomingMessageReceived: hoursAgo(9) } });
    await expect(assessGreenHealth({ now: NOW })).resolves.toMatchObject({ ok: true });
  });

  it("a disabled incoming webhook is a fault at any hour, quiet or not", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...GREEN_OK, incomingWebhook: "no" }), { status: 200 })),
    );
    db({ lastCustomerMessage: hoursAgo(0.1), outbound: 0, webhooks: { incomingMessageReceived: hoursAgo(0.1) } });
    const h = await assessGreenHealth({ now: NOW });
    expect(h.ok).toBe(false);
    expect(h.reason).toContain("incomingWebhook");
  });

  it("an unauthorized instance names the QR scan, the thing a human must go and do", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...GREEN_OK, stateInstance: "notAuthorized" }), { status: 200 })),
    );
    db({ lastCustomerMessage: hoursAgo(0.1), outbound: 0, webhooks: {} });
    const h = await assessGreenHealth({ now: NOW });
    expect(h.ok).toBe(false);
    expect(h.reason).toContain("QR");
  });
});

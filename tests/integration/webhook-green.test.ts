/**
 * POST /api/greenapi/webhook against a real database. The route is imported
 * whole; only the edges that leave the system are replaced:
 *   - GHL (forward + sync), the supervisor, the questionnaire and decision
 *     handlers, Eli's DM, next-action refresh → recording stubs;
 *   - `after()` from next/server → run inline (there is no request scope here);
 *   - WhatsApp sends → BRIDGE_DRY_RUN=1 (vitest.config), no GreenAPI creds.
 * Everything else — auth, the idempotency claim in bridge_events, lead upsert,
 * message insert, website-origin attribution, the teammate gate — is real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ciChatId, ciId, ciPhone, leadsForPhone, purgeSid, sleep, sql } from "./_db";

const stubs = vi.hoisted(() => ({
  forwardMessage: vi.fn(async () => undefined),
  syncLeadToGHL: vi.fn(async () => undefined),
  handleInbound: vi.fn(async () => undefined),
  handleDecisionInbound: vi.fn(async () => undefined),
  refreshNextAction: vi.fn(async () => undefined),
  sendEliDM: vi.fn(async () => "dry_run" as const),
  dispatchSupervisor: vi.fn(async () => ({ shouldRunLegacy: true })),
}));
vi.mock("@/integrations/ghl/sync", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  forwardMessage: stubs.forwardMessage,
  syncLeadToGHL: stubs.syncLeadToGHL,
}));
vi.mock("@/lib/autoresponder/questionnaire", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  handleInbound: stubs.handleInbound,
}));
vi.mock("@/lib/autoresponder/decision", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  handleDecisionInbound: stubs.handleDecisionInbound,
}));
vi.mock("@/lib/ghl/next-action", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  refreshNextAction: stubs.refreshNextAction,
}));
vi.mock("@/lib/notify/eli", () => ({ sendEliDM: stubs.sendEliDM }));
vi.mock("@/lib/supervisor/server/dispatch", () => ({ dispatchSupervisor: stubs.dispatchSupervisor }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  after: (fn: () => unknown) => {
    void Promise.resolve().then(fn);
  },
}));

import { POST } from "@/app/api/greenapi/webhook/route";
import { removeTeamMember, upsertTeamMember } from "@/lib/notify/team";

const TOKEN = process.env.GREEN_WEBHOOK_TOKEN!;
const TEAM_N = 1, CUSTOMER_N = 2, WEBSITE_N = 3, QUOTED_N = 4;
const TEAM_ID = ciId("teammate");
const evtIds: string[] = [];

function incoming(n: number, messageData: Record<string, unknown>, opts: { id?: string; name?: string } = {}) {
  const id = opts.id ?? ciId(`evt-${n}-${Math.random().toString(36).slice(2, 7)}`);
  evtIds.push(id);
  return {
    typeWebhook: "incomingMessageReceived",
    instanceData: { idInstance: 1, wid: "972559662713@c.us" },
    timestamp: Math.floor(Date.now() / 1000),
    idMessage: id,
    senderData: { chatId: ciChatId(n), sender: ciChatId(n), senderName: opts.name ?? "CI Tester", chatName: opts.name ?? "CI Tester" },
    messageData,
  };
}
const text = (t: string) => ({ typeMessage: "textMessage", textMessageData: { textMessage: t } });

function post(body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  return POST(
    new NextRequest(new URL("http://localhost/api/greenapi/webhook"), {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    }),
    undefined,
  );
}

async function messagesFor(phone: string) {
  return (await sql(
    `SELECT m.direction, m.text, m.wa_message_id FROM messages m
     JOIN leads l ON l.manychat_sub_id = m.manychat_sub_id
     WHERE l.phone_e164 = $1 OR l.manychat_sub_id LIKE $2 ORDER BY m.id`,
    [phone, `${phone}@%`],
  )) as { direction: string; text: string | null; wa_message_id: string | null }[];
}

async function cleanup() {
  for (const n of [TEAM_N, CUSTOMER_N, WEBSITE_N, QUOTED_N]) {
    for (const l of await leadsForPhone(ciPhone(n))) await purgeSid(l.manychat_sub_id);
    await purgeSid(ciChatId(n));
  }
  if (evtIds.length) await sql(`DELETE FROM bridge_events WHERE evt_id = ANY($1::text[])`, [evtIds]);
  await removeTeamMember(TEAM_ID);
}

beforeAll(async () => {
  await cleanup();
  await upsertTeamMember({ id: TEAM_ID, name: "CI Teammate", phone: ciPhone(TEAM_N), lang: "en", role: "integration test — safe to delete" });
});
afterAll(cleanup);

describe("auth + envelope", () => {
  it("401 without the webhook token, and no audit row", async () => {
    const body = incoming(CUSTOMER_N, text("hi"));
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, "Bearer wrong")).status).toBe(401);
    const rows = await sql(`SELECT 1 FROM bridge_events WHERE evt_id = $1`, [body.idMessage]);
    expect(rows).toHaveLength(0);
  });

  it("400 on a body that is not JSON", async () => {
    expect((await post("{nope")).status).toBe(400);
  });

  it("the ?secret= query form is accepted too", async () => {
    const body = { typeWebhook: "stateInstanceChanged", stateInstance: "authorized", idMessage: ciId("state") };
    evtIds.push(body.idMessage);
    const res = await POST(
      new NextRequest(new URL(`http://localhost/api/greenapi/webhook?secret=${TOKEN}`), { method: "POST", body: JSON.stringify(body) }),
      undefined,
    );
    expect(res.status).toBe(200);
  });
});

describe("a colleague is never a lead (2026-08-30)", () => {
  it("inbound from a registered team member creates no lead, no message, no GHL sync", async () => {
    const res = await post(incoming(TEAM_N, text("can you explain to me in English?"), { name: "Simon" }));
    expect(res.status).toBe(200);
    await sleep(300);
    expect(await leadsForPhone(ciPhone(TEAM_N))).toEqual([]);
    expect(stubs.syncLeadToGHL).not.toHaveBeenCalled();
    expect(stubs.handleInbound).not.toHaveBeenCalled();
  });
});

describe("a new customer", () => {
  it("creates the lead under the @c.us sid, stores the message, audits the envelope, routes to the questionnaire", async () => {
    const body = incoming(CUSTOMER_N, text("שלום, כמה עולות 3000 שקיות?"), { name: "דני CI" });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await sleep(500);

    const leads = await leadsForPhone(ciPhone(CUSTOMER_N));
    expect(leads).toHaveLength(1);
    expect(leads[0].manychat_sub_id).toBe(ciChatId(CUSTOMER_N));

    const msgs = await messagesFor(ciPhone(CUSTOMER_N));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: "in", text: "שלום, כמה עולות 3000 שקיות?", wa_message_id: body.idMessage });

    const audit = await sql(`SELECT type FROM bridge_events WHERE evt_id = $1`, [body.idMessage]);
    expect(audit).toEqual([{ type: "green.incomingMessageReceived" }]);

    expect(stubs.handleInbound).toHaveBeenCalledTimes(1);
    expect(stubs.forwardMessage).toHaveBeenCalled();
    expect(stubs.syncLeadToGHL).toHaveBeenCalled();
  });

  // 2026-08-26: Green re-delivers a webhook it got no 200 for; יחיאל got the
  // same question three times. The bridge_events claim makes the retry inert.
  it("a re-delivered envelope is deduped — no second message, no second handler run", async () => {
    const body = incoming(CUSTOMER_N, text("הודעה שתגיע פעמיים"));
    expect(await (await post(body)).json()).toEqual({ ok: true });
    await sleep(300);
    const before = (await messagesFor(ciPhone(CUSTOMER_N))).length;
    const calls = stubs.handleInbound.mock.calls.length;

    expect(await (await post(body)).json()).toEqual({ ok: true, deduped: true });
    await sleep(300);
    expect((await messagesFor(ciPhone(CUSTOMER_N))).length).toBe(before);
    expect(stubs.handleInbound.mock.calls.length).toBe(calls);
  });

  // "parse by fallback": 248/248 reply-with-quote rows used to be stored blank.
  it("a quotedMessage keeps its text", async () => {
    await post(incoming(QUOTED_N, {
      typeMessage: "quotedMessage",
      extendedTextMessageData: { text: "כן, 5000 מתאים לי", description: "" },
      quotedMessage: { stanzaId: "x", participant: "972559662713@c.us", typeMessage: "textMessage", textMessage: "כמה?" },
    }));
    await sleep(400);
    const msgs = await messagesFor(ciPhone(QUOTED_N));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("כן, 5000 מתאים לי");
  });
});

describe("website prefill (2026-08-30)", () => {
  it("stamps lead_source=website and writes a source_touches row with the page", async () => {
    await post(incoming(WEBSITE_N, text('היי, אני בעמוד "שקיות אלבד ממותגות" באתר ואשמח להצעת מחיר לשקיות אלבד ממותגות')));
    await sleep(500);
    const leads = await leadsForPhone(ciPhone(WEBSITE_N));
    expect(leads).toHaveLength(1);
    expect(leads[0].lead_source).toBe("website");
    const touches = (await sql(
      `SELECT source_detail_1, source_detail_2 FROM source_touches WHERE manychat_sub_id = $1`,
      [leads[0].manychat_sub_id],
    )) as { source_detail_1: string; source_detail_2: string | null }[];
    expect(touches.length).toBeGreaterThan(0);
    expect(touches[0].source_detail_1).toBe("page_cta");
    expect(touches[0].source_detail_2).toBe("שקיות אלבד ממותגות");
  });
});

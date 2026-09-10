/**
 * /api/bot/followups — one run at a time. Two triggers point at this route (a
 * 15-minute GitHub Action + the daily Vercel cron); the row-claim in app_config
 * is what stops an overlapping pair from nudging the same customer twice.
 * pg advisory locks do NOT work here (Neon's HTTP driver drops the session).
 *
 * Runs the route in dry mode: it composes but never sends, the supervisor is
 * bypassed (SUPERVISOR_BYPASS=1), the setter composer is stubbed (no LLM), and
 * every outbound edge is either BRIDGE_DRY_RUN or a stub.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "./_db";

vi.mock("@/lib/setter/followup", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  composeSetterFollowup: vi.fn(async () => null),
}));
vi.mock("@/lib/clock/hebcal", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isNoSendDay: vi.fn(async () => false),
}));
vi.mock("@/lib/sheets/lead-gaps", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadSheetGaps: vi.fn(async () => ({ total: 0, pendingCount: 0, badPhoneCount: 0, sendFailedCount: 0, otherErrorCount: 0, oldestPendingAt: null, rows: [], fetchedAt: new Date(), spreadsheetId: null })),
}));
vi.mock("@/lib/notify/eli", () => ({ sendEliDM: vi.fn(async () => "dry_run") }));
vi.mock("@/integrations/ghl/sync", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  syncLeadToGHL: vi.fn(async () => undefined),
}));
vi.mock("@/lib/drafts", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generateAndQueueDraft: vi.fn(async () => null),
}));

import { POST } from "@/app/api/bot/followups/route";

const AUTH = `Bearer ${process.env.BOT_SECRET}`;
let originalLock: unknown;

async function lockRow() {
  const r = (await sql(`SELECT value FROM app_config WHERE key = 'followups.lock'`)) as { value: { at: string } }[];
  return r[0]?.value ?? null;
}
function post() {
  return POST(new NextRequest(new URL("http://localhost/api/bot/followups?dry=1"), { method: "POST", headers: { authorization: AUTH } }), undefined);
}

beforeAll(async () => {
  originalLock = await lockRow();
});
afterAll(async () => {
  if (originalLock) await sql(`UPDATE app_config SET value = $1::jsonb WHERE key = 'followups.lock'`, [JSON.stringify(originalLock)]);
});

describe("run lock", () => {
  it("401 without the bot secret", async () => {
    const res = await POST(new NextRequest(new URL("http://localhost/api/bot/followups?dry=1"), { method: "POST" }), undefined);
    expect(res.status).toBe(401);
  });

  it("a held claim makes the next tick answer already_running, and expires after 5 minutes", async () => {
    await sql(`INSERT INTO app_config (key, value, updated_at) VALUES ('followups.lock', jsonb_build_object('at', now()), now())
               ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('at', now()), updated_at = now()`);
    const held = await (await post()).json();
    expect(held).toMatchObject({ ok: true, skipped: "already_running" });

    // backdate the claim past the 5-minute self-expiry → the next tick may run
    await sql(`UPDATE app_config SET value = jsonb_build_object('at', now() - interval '6 minutes') WHERE key = 'followups.lock'`);
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).not.toBe("already_running");
  });

  it("two concurrent ticks: exactly one runs, the other is already_running", async () => {
    await sql(`UPDATE app_config SET value = jsonb_build_object('at', now() - interval '1 hour') WHERE key = 'followups.lock'`);
    const [x, y] = await Promise.all([post(), post()]);
    const bodies = [await x.json(), await y.json()];
    const skipped = bodies.filter((b) => b.skipped === "already_running");
    expect(skipped).toHaveLength(1);
    expect(bodies.every((b) => b.ok === true)).toBe(true);
  });

  it("the claim is released (backdated) when the run finishes", async () => {
    await sql(`UPDATE app_config SET value = jsonb_build_object('at', now() - interval '1 hour') WHERE key = 'followups.lock'`);
    await post();
    const at = Date.parse((await lockRow())!.at);
    expect(Date.now() - at).toBeGreaterThan(30 * 60_000); // backdated ≥ 1h, not "now"
  });
});

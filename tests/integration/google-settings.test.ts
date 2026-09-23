/**
 * Google settings store on a throwaway Neon branch (2026-09-23): the one-row
 * app_config document, its conditional upsert, stale-revision refusal, and the
 * route's auth + validation. Nothing reaches Google Ads.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "./_db";
import { GOOGLE_DEFAULTS_2026_09_23 as D } from "@/lib/ads/google-settings";
import { GOOGLE_SETTINGS_KEY, getGooglePolicy, saveGooglePolicy } from "@/lib/ads/google-settings-store";

const TOKEN = "ci-widget-token";
let prior: unknown = undefined;

beforeAll(async () => {
  process.env.GHL_WIDGET_TOKEN = TOKEN;
  const r = await sql(`SELECT value FROM app_config WHERE key = $1`, [GOOGLE_SETTINGS_KEY]);
  prior = r[0]?.value;
  await sql(`DELETE FROM app_config WHERE key = $1`, [GOOGLE_SETTINGS_KEY]);
});
afterAll(async () => {
  await sql(`DELETE FROM app_config WHERE key = $1`, [GOOGLE_SETTINGS_KEY]);
  if (prior !== undefined) await sql(`INSERT INTO app_config (key, value) VALUES ($1, $2::jsonb)`, [GOOGLE_SETTINGS_KEY, JSON.stringify(prior)]);
});

describe("google settings store", () => {
  it("nothing saved → the defaults, revision 0", async () => {
    const p = await getGooglePolicy();
    expect(p).toMatchObject({ revision: 0, isDefault: true });
  });

  it("first save → revision 1 with history; a stale editor is refused", async () => {
    const s = structuredClone(D);
    s.economics.targetCplIls = 150;
    const r = await saveGooglePolicy(s, { expectedRevision: 0, actor: "ci" });
    expect(r.ok).toBe(true);
    const p = await getGooglePolicy();
    expect(p.revision).toBe(1);
    expect(p.settings.economics.targetCplIls).toBe(150);
    expect(p.history[0].changedKeys.length).toBeGreaterThan(0);

    const again = structuredClone(s);
    again.alerts.clicksWithoutLeadsMin = 40;
    const stale = await saveGooglePolicy(again, { expectedRevision: 0, actor: "ci" });
    expect(stale).toMatchObject({ ok: false, kind: "stale_revision", currentRevision: 1 });

    const ok2 = await saveGooglePolicy(again, { expectedRevision: 1, actor: "ci" });
    expect(ok2.ok).toBe(true);
    const p2 = await getGooglePolicy();
    expect(p2.revision).toBe(2);
    expect(p2.history.map((h) => h.revision)).toEqual([2, 1]);
    expect(p2.history[0].changedKeys).toEqual(["alerts.clicksWithoutLeadsMin"]);
  });

  it("invalid settings are refused and nothing is written", async () => {
    const r = await saveGooglePolicy({ ...structuredClone(D), extra: 1 }, { expectedRevision: 2, actor: "ci" });
    expect(r).toMatchObject({ ok: false, kind: "invalid" });
    expect((await getGooglePolicy()).revision).toBe(2);
  });

  it("the route refuses without the widget token", async () => {
    const { GET } = await import("@/app/api/widget/ads/google-settings/route");
    const res = await GET(new NextRequest(new URL("http://localhost/api/widget/ads/google-settings")), undefined as never);
    expect(res.status).toBe(401);
  });
});

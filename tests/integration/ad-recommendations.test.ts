/**
 * Meta ad recommendations — policy settings + per-Ad-ID review state, through
 * the real route handlers on a throwaway Neon branch.
 *
 * The branch is copied from production, which may not have migration 0004 yet
 * (the tables arrive in prod only after Eli's OK). The migration is idempotent,
 * so this file applies it first — CI stays green either side of the prod apply.
 *
 * Nothing here reaches Meta: the feature has no Meta write path at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "./_db";
import { APPROVED_DEFAULTS_2026_09_18 as D } from "@/lib/ads/recommendation-settings";

const TOKEN = "ci-widget-token";
const BASE = "http://localhost/api/widget/ads";
const KEY = "ads.recommendation.settings";

// Two exact Ad IDs that cannot collide with a real one or with another run.
const AD_A = `99${Date.now()}1`;
const AD_B = `99${Date.now()}2`;

let priorConfig: unknown = undefined;
let startRevision = 0;

async function applyMigration() {
  const file = readFileSync(join(process.cwd(), "drizzle/migrations/0004_ad_recommendations.sql"), "utf8");
  for (const stmt of file.split("--> statement-breakpoint")) {
    const body = stmt.replace(/^\s*--.*$/gm, "").trim();
    if (body) await sql(body);
  }
}

const req = (url: string, init: { method?: string; body?: unknown; token?: string | null } = {}) =>
  new NextRequest(new URL(url), {
    method: init.method ?? "GET",
    headers: {
      ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? TOKEN}` }),
      "content-type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const settingsRoute = () => import("@/app/api/widget/ads/recommendation-settings/route");
const adRoute = () => import("@/app/api/widget/ads/review-state/[adId]/route");
const ctx = (adId: string) => ({ params: Promise.resolve({ adId }) });

async function getSettings() {
  const { GET } = await settingsRoute();
  const res = await GET(req(`${BASE}/recommendation-settings`), undefined as never);
  return { status: res.status, json: (await res.json()) as any };
}
async function putSettings(body: unknown) {
  const { PUT } = await settingsRoute();
  const res = await PUT(req(`${BASE}/recommendation-settings`, { method: "PUT", body }), undefined as never);
  return { status: res.status, json: (await res.json()) as any };
}
async function putAd(adId: string, body: unknown) {
  const { PUT } = await adRoute();
  const res = await PUT(req(`${BASE}/review-state/${adId}`, { method: "PUT", body }), ctx(adId));
  return { status: res.status, json: (await res.json()) as any };
}

beforeAll(async () => {
  await applyMigration();
  const rows = (await sql(`SELECT value FROM app_config WHERE key = $1`, [KEY])) as { value: any }[];
  priorConfig = rows[0]?.value;
  startRevision = Number(priorConfig && (priorConfig as any).revision) || 0;
});

afterAll(async () => {
  // Leave the branch as we found it.
  await sql(`DELETE FROM ad_recommendation_policy_revisions WHERE revision > $1`, [startRevision]);
  if (priorConfig === undefined) await sql(`DELETE FROM app_config WHERE key = $1`, [KEY]);
  else await sql(`UPDATE app_config SET value = $2::jsonb WHERE key = $1`, [KEY, JSON.stringify(priorConfig)]);
  await sql(`DELETE FROM ad_review_state_audit WHERE ad_id IN ($1, $2)`, [AD_A, AD_B]);
  await sql(`DELETE FROM ad_review_state WHERE ad_id IN ($1, $2)`, [AD_A, AD_B]);
});

describe("recommendation settings", () => {
  it("401 without the widget token", async () => {
    const { GET, PUT } = await settingsRoute();
    expect((await GET(req(`${BASE}/recommendation-settings`, { token: null }), undefined as never)).status).toBe(401);
    expect((await PUT(req(`${BASE}/recommendation-settings`, { method: "PUT", body: {}, token: "wrong" }), undefined as never)).status).toBe(401);
  });

  it("GET returns the current policy, the approved defaults and a Markdown summary", async () => {
    const { status, json } = await getSettings();
    expect(status).toBe(200);
    expect(json.policy.revision).toBe(startRevision);
    expect(json.defaults).toEqual(D);
    expect(json.markdown).toContain(`גרסה ${startRevision}`);
  });

  it("a valid save creates the next revision, with history and changed keys", async () => {
    const settings = structuredClone(D);
    settings.gates.maturationDays = 21;
    const { status, json } = await putSettings({ settings, expectedRevision: startRevision });
    expect(status).toBe(200);
    expect(json.policy.revision).toBe(startRevision + 1);

    const hist = (await sql(
      `SELECT changed_keys, settings, actor FROM ad_recommendation_policy_revisions WHERE revision = $1`,
      [startRevision + 1],
    )) as { changed_keys: string[]; settings: any; actor: string }[];
    expect(hist).toHaveLength(1);
    expect(hist[0].settings.gates.maturationDays).toBe(21);
    expect(hist[0].actor).toBe("widget");
    if (startRevision > 0) expect(hist[0].changed_keys).toContain("gates.maturationDays");

    const cfg = (await sql(`SELECT value FROM app_config WHERE key = $1`, [KEY])) as { value: any }[];
    expect(cfg[0].value.revision).toBe(startRevision + 1);
    expect(cfg[0].value.settings.gates.maturationDays).toBe(21);
  });

  it("an invalid save returns Hebrew errors and writes nothing", async () => {
    const settings = structuredClone(D);
    settings.gates.stabilitySpendIls = 50;
    const { status, json } = await putSettings({ settings, expectedRevision: startRevision + 1 });
    expect(status).toBe(400);
    expect(json.errors[0].path).toBe("gates.stabilitySpendIls");
    expect(json.errors[0].message).toMatch(/[א-ת]/);
    const after = await getSettings();
    expect(after.json.policy.revision).toBe(startRevision + 1);
    expect(after.json.policy.settings.gates.stabilitySpendIls).toBe(250);
  });

  it("a save from a stale revision is refused with 409", async () => {
    const { status, json } = await putSettings({ settings: D, expectedRevision: startRevision });
    expect(status).toBe(409);
    expect(json.currentRevision).toBe(startRevision + 1);
  });

  it("two concurrent saves from the same revision: exactly one lands", async () => {
    const a = structuredClone(D);
    a.gates.maturationDays = 10;
    const b = structuredClone(D);
    b.gates.maturationDays = 12;
    const results = await Promise.all([
      putSettings({ settings: a, expectedRevision: startRevision + 1 }),
      putSettings({ settings: b, expectedRevision: startRevision + 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const cfg = (await sql(`SELECT value FROM app_config WHERE key = $1`, [KEY])) as { value: any }[];
    const hist = (await sql(
      `SELECT settings FROM ad_recommendation_policy_revisions WHERE revision = $1`,
      [startRevision + 2],
    )) as { settings: any }[];
    expect(cfg[0].value.revision).toBe(startRevision + 2);
    // The config and the history agree on which save won.
    expect(cfg[0].value.settings.gates.maturationDays).toBe(hist[0].settings.gates.maturationDays);
  });
});

describe("per-Ad-ID review state", () => {
  it("401 without the widget token", async () => {
    const { PUT } = await adRoute();
    const res = await PUT(req(`${BASE}/review-state/${AD_A}`, { method: "PUT", body: { segment: "prospecting" }, token: null }), ctx(AD_A));
    expect(res.status).toBe(401);
  });

  it("a status change without a reason is refused and nothing is written", async () => {
    const { status } = await putAd(AD_A, { approvedStatus: "winner" });
    expect(status).toBe(400);
    const rows = await sql(`SELECT 1 FROM ad_review_state WHERE ad_id = $1`, [AD_A]);
    expect(rows).toHaveLength(0);
  });

  it("saves segment/role, then a status with reason — each change audited with its old value", async () => {
    expect((await putAd(AD_A, { segment: "prospecting", role: "control" })).status).toBe(200);
    const r = await putAd(`ag:${AD_A}`, { approvedStatus: "winner", reason: "2 עסקאות CRM" });
    expect(r.status).toBe(200);
    expect(r.json.state).toMatchObject({ adId: AD_A, approvedStatus: "winner", segment: "prospecting", role: "control", decisionReason: "2 עסקאות CRM" });
    expect(r.json.changedFields).toEqual(["approved_status"]);

    await putAd(AD_A, { approvedStatus: "testing", reason: "CAC מעל התקרה" });
    const audit = (await sql(
      `SELECT field, old_value, new_value, reason FROM ad_review_state_audit WHERE ad_id = $1 ORDER BY id`,
      [AD_A],
    )) as { field: string; old_value: string | null; new_value: string; reason: string | null }[];
    expect(audit).toEqual([
      { field: "segment", old_value: null, new_value: "prospecting", reason: null },
      { field: "role", old_value: null, new_value: "control", reason: null },
      { field: "approved_status", old_value: "untested", new_value: "winner", reason: "2 עסקאות CRM" },
      { field: "approved_status", old_value: "winner", new_value: "testing", reason: "CAC מעל התקרה" },
    ]);
  });

  it("re-saving the same value writes no audit row", async () => {
    const before = await sql(`SELECT count(*)::int n FROM ad_review_state_audit WHERE ad_id = $1`, [AD_A]);
    const r = await putAd(AD_A, { segment: "prospecting" });
    expect(r.json.changedFields).toEqual([]);
    const after = await sql(`SELECT count(*)::int n FROM ad_review_state_audit WHERE ad_id = $1`, [AD_A]);
    expect(after).toEqual(before);
  });

  it("a policy save never changes an approved status", async () => {
    await putAd(AD_B, { approvedStatus: "loser", reason: "אין עסקה אחרי ₪500 והבשלה" });
    const cur = await getSettings();
    const s = structuredClone(cur.json.policy.settings);
    s.economics.maxCacIls = 600;
    expect((await putSettings({ settings: s, expectedRevision: cur.json.policy.revision })).status).toBe(200);
    const rows = (await sql(`SELECT ad_id, approved_status FROM ad_review_state WHERE ad_id IN ($1,$2) ORDER BY ad_id`, [AD_A, AD_B])) as { ad_id: string; approved_status: string }[];
    expect(rows.map((r) => r.approved_status)).toEqual(["testing", "loser"]);
  });

  it("GET returns the state and its audit trail; a name instead of an ID is refused", async () => {
    const { GET } = await adRoute();
    const res = await GET(req(`${BASE}/review-state/${AD_A}`), ctx(AD_A));
    const json = (await res.json()) as any;
    expect(json.state.approvedStatus).toBe("testing");
    expect(json.audit[0]).toMatchObject({ field: "approved_status", newValue: "testing" });
    const bad = await GET(req(`${BASE}/review-state/C-magic-hat-trick`), ctx("C-magic-hat-trick"));
    expect(bad.status).toBe(400);
  });
});

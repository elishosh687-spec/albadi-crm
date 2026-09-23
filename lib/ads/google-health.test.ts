/**
 * lib/ads/google-health.ts — the pure evaluation of "is the Google side
 * working" (2026-09-23).
 */
import { describe, expect, it } from "vitest";
import { evaluateGoogleHealth, type GoogleHealthFacts } from "./google-health";
import { foldGoogleEvidence } from "./google-evidence";
import { GOOGLE_DEFAULTS_2026_09_23 as S } from "./google-settings";

const TODAY = "2026-10-10";
const camp = (status: string, days: [string, number, number][]) =>
  foldGoogleEvidence(
    [{ campaign: { id: "1", name: "Search", status } }],
    days.map(([date, cost, clicks]) => ({ campaign: { id: "1", name: "Search", status }, segments: { date }, metrics: { costMicros: String(cost * 1e6), clicks: String(clicks) } })),
    [],
  );

const base = (p: Partial<GoogleHealthFacts> = {}): GoogleHealthFacts => ({
  today: TODAY,
  read: { ok: true },
  autoTagging: true,
  snapshot: { ok: true, campaigns: camp("ENABLED", [["2026-10-09", 50, 12]]), fetchedAt: "", historyStart: "2026-08-01" },
  notServing: [],
  autoApplied: [],
  formConversionsByDay: new Map([["2026-10-09", 1]]),
  crmFormLeadsByDay: new Map([["2026-10-09", 1]]),
  crmLeadsInWindow: 3,
  unattributedRecent: { notFound: 0, names: [] },
  landing: [{ url: "https://albadisael.com/", status: 200 }],
  jobs: [],
  ...p,
});
const check = (f: GoogleHealthFacts, key: string) => evaluateGoogleHealth(f, S).checks.find((c) => c.key === key)!;

describe("evaluateGoogleHealth", () => {
  it("all green on a healthy day", () => {
    const h = evaluateGoogleHealth(base(), S);
    expect(h.checks.filter((c) => !c.ok)).toEqual([]);
    expect(h.ok).toBe(true);
  });

  it("Google unreadable → one red line, the rest say not checked", () => {
    const h = evaluateGoogleHealth(base({ read: { ok: false, reason: "פגה" }, snapshot: null, notServing: null, autoApplied: null, formConversionsByDay: null, landing: null }), S);
    expect(h.problems).toBe(1);
    expect(h.checks.find((c) => c.key === "google-read")!.detail).toBe("פגה");
    expect(h.checks.find((c) => c.key === "serving")!.detail).toContain("לא נבדק");
  });

  it("auto-tagging off is red", () => {
    expect(check(base({ autoTagging: false }), "auto-tagging").ok).toBe(false);
  });

  it("an ENABLED campaign with ₪0 yesterday is red; a PAUSED one is not", () => {
    const silent = { ok: true as const, campaigns: camp("ENABLED", [["2026-10-09", 0, 0]]), fetchedAt: "", historyStart: "" };
    expect(check(base({ snapshot: silent }), "spend").ok).toBe(false);
    const paused = { ok: true as const, campaigns: camp("PAUSED", []), fetchedAt: "", historyStart: "" };
    const c = check(base({ snapshot: paused }), "spend");
    expect(c.ok).toBe(true);
    expect(c.detail).toBe("אין קמפיין פעיל כרגע");
  });

  it("today's partial spend does not count as yesterday's", () => {
    const s = { ok: true as const, campaigns: camp("ENABLED", [["2026-10-10", 30, 5]]), fetchedAt: "", historyStart: "" };
    expect(check(base({ snapshot: s }), "spend").ok).toBe(false);
  });

  it("30+ clicks and no CRM lead is red", () => {
    const s = { ok: true as const, campaigns: camp("ENABLED", [["2026-10-08", 90, 20], ["2026-10-09", 80, 15]]), fetchedAt: "", historyStart: "" };
    expect(check(base({ snapshot: s, crmLeadsInWindow: 0 }), "clicks-leads").ok).toBe(false);
    expect(check(base({ snapshot: s, crmLeadsInWindow: 1 }), "clicks-leads").ok).toBe(true);
  });

  it("Google counted form leads the CRM never got → red with the day", () => {
    const c = check(base({ formConversionsByDay: new Map([["2026-10-08", 3]]), crmFormLeadsByDay: new Map() }), "gap");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("10-08: גוגל 3 · CRM 0");
  });

  it("a difference within tolerance is not red", () => {
    expect(check(base({ formConversionsByDay: new Map([["2026-10-08", 1]]), crmFormLeadsByDay: new Map() }), "gap").ok).toBe(true);
  });

  it("auto-applied recommendation, disapproved ad, broken landing page, not-found click → red", () => {
    expect(check(base({ autoApplied: [{ at: "2026-10-09 04:00:00", campaign: "Search", resource: "AD_GROUP_CRITERION" }] }), "auto-applied").ok).toBe(false);
    expect(check(base({ notServing: [{ campaign: "Search", what: "מודעה 1 נדחתה" }] }), "serving").ok).toBe(false);
    expect(check(base({ landing: [{ url: "https://albadisael.com/x", status: 404 }] }), "landing").ok).toBe(false);
    expect(check(base({ unattributedRecent: { notFound: 1, names: ["דנה"] } }), "attribution").ok).toBe(false);
  });
});

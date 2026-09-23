/**
 * Architecture rule — the Meta ad recommendation feature is READ-ONLY toward
 * Meta (design 2026-09-18: "No code path can activate, pause, edit, or budget
 * a Meta object"). A future write integration needs its own design and Eli's
 * explicit authorization; until then, any of these shapes appearing in the
 * feature's files fails here, before it can ship.
 *
 * Scans the feature's own directories plus the Meta read helper it depends on.
 * `lib/meta/capi.ts` (conversion events, a different feature) is out of scope.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const DIRS = ["lib/ads", "app/api/widget/ads", "components/ads", "app/widget/ads"];
const FILES = ["lib/meta/ads-insights.ts"];

const FORBIDDEN: [RegExp, string][] = [
  [/method:\s*["'](POST|DELETE|PUT|PATCH)["'][^]*graph\.facebook\.com|graph\.facebook\.com[^]*method:\s*["'](POST|DELETE|PUT|PATCH)["']/, "a non-GET call to the Graph API"],
  [/["']?status["']?\s*[:=]\s*["'](PAUSED|ACTIVE|ARCHIVED|DELETED)["']/, "setting a Meta object status"],
  [/\b(daily_budget|lifetime_budget|bid_amount)\b/, "a Meta budget or bid field"],
  [/\/copies\b/, "duplicating a Meta object"],
];

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

describe("Meta ad recommendations never write to Meta", () => {
  const files = [...DIRS.flatMap(walk), ...FILES.filter((f) => fs.existsSync(path.join(ROOT, f)))];

  it("scans the feature (sanity — the directories exist)", () => {
    expect(files.some((f) => f.startsWith("lib/ads/"))).toBe(true);
    expect(files.some((f) => f.startsWith("app/api/widget/ads/"))).toBe(true);
  });

  for (const f of files) {
    it(f, () => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const [re, what] of FORBIDDEN) {
        expect(re.test(src), `${f} contains ${what}`).toBe(false);
      }
    });
  }
});

/**
 * Same rule for Google Ads (2026-09-23). Google's OAuth scope cannot be made
 * read-only, so this test IS the read-only guard: `lib/google/*` may only run
 * `googleAds:searchStream` (GAQL SELECT). Conversion uploads (plan phase 5)
 * need their own design and Eli's explicit OK — and a change here.
 */
describe("Google Ads code never writes to Google Ads", () => {
  const G_FORBIDDEN: [RegExp, string][] = [
    [/:mutate\b|\bmutate[A-Z]\w*\s*\(|\/mutate\b/, "a Google Ads mutate call"],
    [/uploadClickConversions|uploadCallConversions|uploadUserData|:upload\b|datamanager\.googleapis/i, "a conversion/data upload"],
    [/googleAds:(?!searchStream\b)\w+/, "a Google Ads service call other than searchStream"],
  ];
  const gfiles = ["lib/google"].flatMap(walk);

  it("scans lib/google (sanity)", () => {
    expect(gfiles).toContain("lib/google/ads-client.ts");
  });

  for (const f of gfiles) {
    it(f, () => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const [re, what] of G_FORBIDDEN) {
        expect(re.test(src), `${f} contains ${what}`).toBe(false);
      }
    });
  }
});

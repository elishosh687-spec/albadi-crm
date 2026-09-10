/**
 * Architecture rule — CLAUDE.md "Scheduled jobs ring a phone":
 *
 *   "A new cron MUST be added to `JOBS` and wrapped with `withJob`, or it is
 *    invisible again." and "Any bearer-authed job under /api/factory/* must
 *    ALSO be added to the allow-list in middleware.ts — the route's own auth
 *    is never reached otherwise."
 *
 * The refit-estimator cron was dead from 2026-06-24 to 2026-09-09 because its
 * path was missing from that allow-list: Vercel's daily GET got a 307 to
 * /login, which is "not a run" to every layer, and nothing said a word.
 *
 * `JobDef` carries no route — the job→route link is the `withJob("<name>", …)`
 * call inside a route file, so we derive it by scanning app/api.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FEATURES } from "@/lib/observability/log";
import { JOBS } from "@/lib/observability/jobs";

const ROOT = path.resolve(__dirname, "../../..");
const PROD = "https://albadi-crm.vercel.app";

/**
 * Workflow-called CRM endpoints that are NOT scheduled jobs and therefore
 * have no heartbeat on purpose. Every entry needs a reason.
 */
const EXEMPT_WORKFLOW_PATHS: Record<string, string> = {
  // workflow_dispatch only — a person turns a GreenAPI webhook flag on/off;
  // it mutates the live instance and must never run on a schedule.
  "/api/admin/greenapi-settings": "manual-only (greenapi-settings.yml): instance settings write, no schedule",
  // workflow_dispatch only — spends real LLM calls to run the setter's eval
  // suite; a report, not a job.
  "/api/admin/setter-eval": "manual-only (setter-eval.yml): offline evaluation, no schedule",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

/** job name → { route, feature } from every withJob("<job>", "<feature>", …) call site. */
function jobRoutes(): Map<string, { route: string; feature: string; file: string }[]> {
  const out = new Map<string, { route: string; feature: string; file: string }[]>();
  const re = /\bwithJob\s*(?:<[^()]*?>)?\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;
  for (const file of walk(path.join(ROOT, "app/api"))) {
    const src = fs.readFileSync(file, "utf8");
    const route = "/" + path.relative(path.join(ROOT, "app"), path.dirname(file)).split(path.sep).join("/");
    for (const m of src.matchAll(re)) {
      const list = out.get(m[1]) ?? [];
      list.push({ route, feature: m[2], file: path.relative(ROOT, file) });
      out.set(m[1], list);
    }
  }
  return out;
}

/** The hardcoded `path === "/api/factory/…"` literals in middleware's cron bearer branch. */
function middlewareAllowList(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "middleware.ts"), "utf8");
  return [...src.matchAll(/path\s*===\s*["'](\/api\/factory\/[^"']+)["']/g)].map((m) => m[1]);
}

function middlewareMatcher(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "middleware.ts"), "utf8");
  const block = /matcher:\s*\[([\s\S]*?)\]/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

function vercelCronPaths(): string[] {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { crons?: { path: string }[] };
  return (json.crons ?? []).map((c) => c.path);
}

/** Every prod /api/... URL any workflow curls, with the workflow file. */
function workflowCalls(): { path: string; workflow: string }[] {
  const dir = path.join(ROOT, ".github/workflows");
  const out: { path: string; workflow: string }[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const src = fs.readFileSync(path.join(dir, name), "utf8");
    for (const m of src.matchAll(new RegExp(`${PROD.replace(/\./g, "\\.")}(/api/[A-Za-z0-9_/.-]+)`, "g"))) {
      out.push({ path: m[1], workflow: name });
    }
  }
  return out;
}

describe("scheduled jobs: JOBS ↔ withJob ↔ middleware ↔ vercel.json ↔ workflows", () => {
  const routes = jobRoutes();
  const jobNames = Object.keys(JOBS);

  it("every JOBS entry is wired to exactly one withJob route (no invisible job)", () => {
    const missing = jobNames.filter((j) => !routes.has(j));
    const dup = jobNames.filter((j) => (routes.get(j)?.length ?? 0) > 1);
    expect(missing, `JOBS entries with no withJob("<name>") call site: ${missing.join(", ")}`).toEqual([]);
    expect(dup, `JOBS entries wrapped in more than one route: ${dup.join(", ")}`).toEqual([]);
  });

  it("every withJob call site names a JOBS entry and a FEATURES member", () => {
    for (const [job, sites] of routes) {
      expect(jobNames, `${sites[0].file} uses withJob("${job}") which is not in JOBS`).toContain(job);
      for (const s of sites) expect(FEATURES as readonly string[], `${s.file}: feature "${s.feature}"`).toContain(s.feature);
    }
  });

  it("every job route under /api/factory/ is on middleware's cron-bearer allow-list", () => {
    const allow = middlewareAllowList();
    expect(allow.length, "middleware allow-list parse came back empty — did the branch move?").toBeGreaterThan(0);
    // The allow-list only matters because the matcher covers the prefix; if
    // that ever changes, this whole test needs rethinking, so assert it.
    expect(middlewareMatcher()).toContain("/api/factory/:path*");

    const factoryJobs = [...routes.values()].flat().filter((s) => s.route.startsWith("/api/factory/"));
    expect(factoryJobs.length, "no factory jobs found — scanner broke?").toBeGreaterThan(0);
    const blocked = factoryJobs.filter((s) => !allow.includes(s.route)).map((s) => `${s.route} (${s.file})`);
    expect(
      blocked,
      `these jobs will be 307'd to /login by middleware.ts before their own auth runs (the refit-estimator outage):\n${blocked.join("\n")}`,
    ).toEqual([]);
  });

  it("every vercel.json cron path is a withJob route with a JOBS entry", () => {
    const jobPaths = new Set([...routes.values()].flat().map((s) => s.route));
    const unwrapped = vercelCronPaths().filter((p) => !jobPaths.has(p));
    expect(unwrapped, `vercel crons invisible to the watchdog:\n${unwrapped.join("\n")}`).toEqual([]);
  });

  it("every vercel cron route exists", () => {
    for (const p of vercelCronPaths()) {
      expect(fs.existsSync(path.join(ROOT, "app", p, "route.ts")), `${p} has no route.ts`).toBe(true);
    }
  });

  it("every prod endpoint a GitHub workflow calls is a JOBS route or explicitly exempt", () => {
    const calls = workflowCalls();
    expect(calls.length, "no workflow URLs found — regex broke?").toBeGreaterThan(5);
    const jobPaths = new Set([...routes.values()].flat().map((s) => s.route));
    const orphans = calls
      .filter((c) => !jobPaths.has(c.path) && !(c.path in EXEMPT_WORKFLOW_PATHS))
      .map((c) => `${c.path} ← ${c.workflow}`);
    expect(orphans, `workflow-triggered endpoints with no heartbeat and no exemption:\n${orphans.join("\n")}`).toEqual([]);
  });

  it("the exempt list is minimal: every exempt path is still called, and none of them became a job", () => {
    const called = new Set(workflowCalls().map((c) => c.path));
    const jobPaths = new Set([...routes.values()].flat().map((s) => s.route));
    for (const p of Object.keys(EXEMPT_WORKFLOW_PATHS)) {
      expect(called.has(p), `${p} is exempt but no workflow calls it any more — prune it`).toBe(true);
      expect(jobPaths.has(p), `${p} is now a withJob route — prune the exemption`).toBe(false);
    }
  });

  it("the exempt workflows really are manual-only (no schedule:)", () => {
    for (const { path: p, workflow } of workflowCalls()) {
      if (!(p in EXEMPT_WORKFLOW_PATHS)) continue;
      const src = fs.readFileSync(path.join(ROOT, ".github/workflows", workflow), "utf8");
      expect(/^\s*schedule:/m.test(src), `${workflow} has a schedule — ${p} can no longer be exempt`).toBe(false);
    }
  });
});

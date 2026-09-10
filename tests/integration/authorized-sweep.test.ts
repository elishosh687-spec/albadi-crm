/**
 * Every route that declares its own bearer check (`authorized()` / `authed()`,
 * copy-pasted into ~35 files) must answer 401 to a request with no bearer —
 * for every HTTP method it exports. A new route that forgets the check, or a
 * refactor that moves the check below a side effect, shows up here.
 *
 * Runs in the integration project because importing a route pulls in the DB
 * client; nothing here should reach the database (auth runs first), and the
 * secrets are set in vitest.config so `!secret → false` is never the reason
 * for a 401.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const ROOT = path.resolve(__dirname, "../..");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

const routes = walk(path.join(ROOT, "app/api")).filter((f) =>
  /function (authorized|authed)\(/.test(fs.readFileSync(f, "utf8")),
);

/**
 * Methods whose gate is NOT the route's own bearer but middleware.ts (the
 * dashboard cookie on the /api/factory/* matcher). Calling the handler directly
 * skips middleware, so these would "fail" here while being protected in prod.
 * Each entry names the reason; a test below checks the middleware matcher still
 * covers the prefix, so an exemption cannot outlive the thing it relies on.
 */
const MIDDLEWARE_GATED: Record<string, Partial<Record<(typeof METHODS)[number], string>>> = {
  "app/api/factory/refit-estimator/route.ts": {
    POST: "manual trigger from the dashboard — cookie auth via middleware.ts; the bearer check is GET-only (the cron)",
  },
};
const middlewareSrc = fs.readFileSync(path.join(ROOT, "middleware.ts"), "utf8");

function urlFor(file: string): string {
  const rel = path.relative(path.join(ROOT, "app"), path.dirname(file));
  // /api/x/[id]/y → /api/x/ci/y
  return "http://localhost/" + rel.replace(/\[\.\.\.[^\]]+\]/g, "ci").replace(/\[[^\]]+\]/g, "ci");
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label}: no response in ${ms}ms — is work happening before auth?`)), ms)),
  ]);
}

describe("bearer-protected routes answer 401 without a bearer", () => {
  it("the scanner found the copy-pasted auth functions", () => {
    expect(routes.length).toBeGreaterThan(25);
  });

  it("every middleware-gated exemption still sits under a prefix middleware.ts matches", () => {
    for (const rel of Object.keys(MIDDLEWARE_GATED)) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} no longer exists — prune the exemption`).toBe(true);
      const url = urlFor(path.join(ROOT, rel)).replace("http://localhost", "");
      const prefix = url.split("/").slice(0, 3).join("/"); // "/api/factory"
      expect(middlewareSrc, `${rel} is exempt because middleware gates ${prefix}, but the matcher no longer lists it`).toContain(`"${prefix}/:path*"`);
    }
  });

  for (const file of routes) {
    const rel = path.relative(ROOT, file);
    it(rel, async () => {
      const mod = (await import(file)) as Record<string, unknown>;
      const exported = METHODS.filter((m) => typeof mod[m] === "function");
      expect(exported.length, `${rel} exports no HTTP method`).toBeGreaterThan(0);
      for (const m of exported) {
        if (MIDDLEWARE_GATED[rel]?.[m]) continue;
        const handler = mod[m] as (req: NextRequest, ctx: unknown) => Promise<Response>;
        const req = new NextRequest(new URL(urlFor(file)), {
          method: m,
          ...(m === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }),
        });
        const res = await withTimeout(handler(req, { params: Promise.resolve({ id: "ci", token: "ci", name: "ci" }) }), 15_000, `${rel} ${m}`);
        expect(res.status, `${rel} ${m} without a bearer`).toBe(401);
      }
    });
  }
});

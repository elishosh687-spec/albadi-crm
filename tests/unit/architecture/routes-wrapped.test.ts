/**
 * Architecture rule — CLAUDE.md "Project layout & logging":
 *   "A new route MUST use `withRequestLog`; a new `console.log` is a regression."
 *
 * 1. Every app/api/** /route.ts is wrapped with withRequestLog( or withJob(
 *    (the job wrapper wraps withRequestLog from the outside). An unwrapped
 *    route's uncaught throw is a Vercel crash page with no `feature` /
 *    `request_id` line in Axiom.
 * 2. No console.(log|error|warn|info)( under app/, lib/, integrations/ —
 *    logging goes through lib/observability/log.ts. The only survivors are
 *    the operator-stdout lines of the two one-shot CLIs, and the transport
 *    itself (log.ts IS the console call).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

/** Allowed console.* callers (CLAUDE.md names the two CLIs; log.ts is the transport). */
const CONSOLE_ALLOWED = [
  "integrations/ghl/bootstrap.ts",
  "integrations/ghl/register-conversation-provider.ts",
  "lib/observability/log.ts",
];

const CONSOLE_RE = /\bconsole\.(log|error|warn|info)\(/;
// withRequestLog( | withRequestLog<NextRequest, Ctx>( | withJob("name", ...
const WRAPPED_RE = /\bwith(RequestLog|Job)\s*(<[^()]*?>)?\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f);

describe("every API route is wrapped by withRequestLog / withJob", () => {
  const routes = walk(path.join(ROOT, "app/api")).filter((f) => path.basename(f) === "route.ts");

  it("finds the route tree (sanity)", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it("no app/api/**/route.ts exports a bare handler", () => {
    const unwrapped = routes.filter((f) => !WRAPPED_RE.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(unwrapped, `routes without withRequestLog/withJob:\n${unwrapped.join("\n")}`).toEqual([]);
  });
});

describe("no console.* outside the logger", () => {
  const sources = ["app", "lib", "integrations"].flatMap((d) => walk(path.join(ROOT, d)));

  function offenders(files: string[]): string[] {
    const out: string[] = [];
    for (const f of files) {
      if (CONSOLE_ALLOWED.includes(rel(f))) continue;
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (CONSOLE_RE.test(line)) out.push(`${rel(f)}:${i + 1}`);
      });
    }
    return out;
  }

  // ⚠️ REAL VIOLATION TODAY (2026-09-10) — marked `it.fails` rather than
  // weakened. Four console.error calls survive in the DEAD dashboard tree
  // (CLAUDE.md: "/dashboard/v3 is dead, only /widget/hub matters"):
  //   app/dashboard/v3/_components/factory/FactoryQuotePanel.tsx:191,210,330
  //   app/dashboard/v3/factory/_components/FactoryQuotesView.tsx:49
  // They are client components, so the lines never reach Axiom either way;
  // the fix is deleting the tree or migrating them. When that lands this
  // test will "fail" (unexpected pass) — drop the `.fails` then.
  it.fails("no console.(log|error|warn|info) under app/, lib/, integrations/ except the two CLIs", () => {
    const bad = offenders(sources);
    expect(bad, `console.* outside the logger:\n${bad.join("\n")}`).toEqual([]);
  });

  // The rule where it matters — server code, whose lines are what Axiom
  // ingests. Strict, so a new console.* in a route/lib is a red build.
  it("no console.* in lib/, integrations/ or app/api/ (the server side)", () => {
    const server = sources.filter((f) => {
      const r = rel(f);
      return r.startsWith("lib/") || r.startsWith("integrations/") || r.startsWith("app/api/");
    });
    const bad = offenders(server);
    expect(bad, `console.* outside the logger:\n${bad.join("\n")}`).toEqual([]);
  });

  it("the known dashboard debt is exactly the four calls above (no new ones)", () => {
    const client = sources.filter((f) => rel(f).startsWith("app/") && !rel(f).startsWith("app/api/"));
    // Pinned per file (not per line) so an unrelated edit above them doesn't
    // trip this; a fifth call, or a call in a new file, does.
    const perFile: Record<string, number> = {};
    for (const hit of offenders(client)) {
      const file = hit.replace(/:\d+$/, "");
      perFile[file] = (perFile[file] ?? 0) + 1;
    }
    expect(perFile).toEqual({
      "app/dashboard/v3/_components/factory/FactoryQuotePanel.tsx": 3,
      "app/dashboard/v3/factory/_components/FactoryQuotesView.tsx": 1,
    });
  });
});
